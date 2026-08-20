//go:build windows

package main

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.zx2c4.com/wireguard/tun"
)

var cachedPhysGW string

func runCmd(timeout time.Duration, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	var out []byte
	var err error
	done := make(chan struct{})
	go func() {
		out, err = cmd.CombinedOutput()
		close(done)
	}()
	select {
	case <-done:
		return out, err
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return nil, fmt.Errorf("%s timed out", name)
	}
}

func alreadyExists(out string) bool {
	s := strings.ToLower(out)
	return strings.Contains(s, "already exists") ||
		strings.Contains(s, "уже существует") ||
		strings.Contains(s, "object already exists") ||
		strings.Contains(s, "file exists") ||
		strings.Contains(s, "элемент уже существует") ||
		strings.Contains(s, "the route addition failed: already exists")
}

func ifIndexByName(name string) (int, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return 0, err
	}
	for _, ifi := range ifaces {
		if strings.EqualFold(ifi.Name, name) {
			return ifi.Index, nil
		}
	}
	return 0, fmt.Errorf("interface %q not found", name)
}

func ifaceHasIPv4(name, want string) bool {
	ifi, err := net.InterfaceByName(name)
	if err != nil {
		return false
	}
	addrs, err := ifi.Addrs()
	if err != nil {
		return false
	}
	for _, a := range addrs {
		ipNet, ok := a.(*net.IPNet)
		if !ok || ipNet.IP.To4() == nil {
			continue
		}
		if ipNet.IP.String() == want {
			return true
		}
	}
	return false
}

func defaultGatewayHint() string {
	if cachedPhysGW != "" {
		return cachedPhysGW
	}
	out, err := runCmd(800*time.Millisecond, "route", "print", "0.0.0.0")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[0] != "0.0.0.0" || fields[1] != "0.0.0.0" {
			continue
		}
		gw := fields[2]
		if ip := net.ParseIP(gw); ip != nil && ip.To4() != nil && gw != "0.0.0.0" {
			cachedPhysGW = gw
			return gw
		}
	}
	return ""
}

func dottedMask(ones int) string {
	return net.IP(net.CIDRMask(ones, 32)).String()
}

func addIfaceRoute(dest, mask, nexthop string, ifIndex int) error {
	// nexthop = IP туннеля (не 0.0.0.0) — иначе Windows часто молча не ставит маршрут
	args := []string{"add", dest, "mask", mask, nexthop, "IF", strconv.Itoa(ifIndex), "METRIC", "1"}
	out, err := runCmd(2*time.Second, "route", args...)
	if err != nil && !alreadyExists(string(out)) {
		// fallback netsh
		cidr := dest + "/" + maskToPrefix(mask)
		out2, err2 := runCmd(2*time.Second, "netsh", "interface", "ipv4", "add", "route",
			cidr, "interface="+strconv.Itoa(ifIndex), "nexthop="+nexthop, "metric=1", "store=active")
		if err2 != nil && !alreadyExists(string(out2)) {
			return fmt.Errorf("route %s: %s / %s", dest, strings.TrimSpace(string(out)), strings.TrimSpace(string(out2)))
		}
	}
	return nil
}

func maskToPrefix(mask string) string {
	ip := net.ParseIP(mask)
	if ip == nil {
		return "32"
	}
	ones, _ := net.IPMask(ip.To4()).Size()
	return strconv.Itoa(ones)
}

func delIfaceRoute(dest, mask string, ifIndex int) {
	if ifIndex > 0 {
		_, _ = runCmd(1*time.Second, "route", "delete", dest, "mask", mask, "IF", strconv.Itoa(ifIndex))
	} else {
		_, _ = runCmd(1*time.Second, "route", "delete", dest, "mask", mask)
	}
}

func hasSplitDefault(ifIndex int) bool {
	out, err := runCmd(800*time.Millisecond, "route", "print", "0.0.0.0")
	if err != nil {
		return false
	}
	want := strconv.Itoa(ifIndex)
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		// 0.0.0.0 128.0.0.0 nexthop iface ...
		if len(fields) >= 4 && fields[0] == "0.0.0.0" && fields[1] == "128.0.0.0" {
			if fields[len(fields)-1] == want || strings.Contains(line, " "+want+" ") {
				return true
			}
			// иногда IF в 4-й колонке как metric layout varies — ищем индекс
			for _, f := range fields {
				if f == want {
					return true
				}
			}
		}
	}
	// также проверим 128.0.0.0/1
	out2, err := runCmd(800*time.Millisecond, "route", "print", "128.0.0.0")
	if err != nil {
		return false
	}
	return strings.Contains(string(out2), "128.0.0.0") && strings.Contains(string(out2), "128.0.0.0")
}

func applyNetConfig(iface string, _ tun.Device, cfg *netConfig) error {
	gen := netGen.Add(1)
	// После sleep / смены Wi‑Fi старый шлюз часто неверный
	cachedPhysGW = ""

	ip, ipNet, err := net.ParseCIDR(cfg.Address)
	if err != nil {
		return fmt.Errorf("parse address: %w", err)
	}
	if ip.To4() == nil {
		return fmt.Errorf("нужен IPv4 address")
	}
	ones, _ := ipNet.Mask.Size()
	tunIP := ip.String()

	var ifIndex int
	for i := 0; i < 40; i++ {
		if netGen.Load() != gen {
			return fmt.Errorf("cancelled")
		}
		ifIndex, err = ifIndexByName(iface)
		if err == nil {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if ifIndex == 0 {
		return fmt.Errorf("ifIndex: %w", err)
	}

	// Физический шлюз — ДО смены default (кэш)
	gw := defaultGatewayHint()

	out, err := runCmd(3*time.Second, "netsh", "interface", "ipv4", "set", "address",
		"name="+iface, "source=static",
		"address="+tunIP, "mask="+dottedMask(ones))
	if err != nil && !alreadyExists(string(out)) {
		out2, err2 := runCmd(3*time.Second, "netsh", "interface", "ipv4", "add", "address",
			"name="+iface, "address="+tunIP, "mask="+dottedMask(ones))
		if err2 != nil && !alreadyExists(string(out2)) {
			return fmt.Errorf("set address: %s", strings.TrimSpace(string(out)))
		}
	}

	deadline := time.Now().Add(3 * time.Second)
	for !ifaceHasIPv4(iface, tunIP) {
		if netGen.Load() != gen {
			return fmt.Errorf("cancelled")
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("address %s not on %s", tunIP, iface)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Endpoint сервера мимо VPN
	if host, _, err := splitHostPort(cfg.Endpoint); err == nil && gw != "" {
		if net.ParseIP(host) != nil {
			_, _ = runCmd(1*time.Second, "route", "delete", host)
			_, _ = runCmd(2*time.Second, "route", "add", host, "mask", "255.255.255.255", gw)
		}
	}

	// LAN bypass
	for _, cidr := range cfg.BypassRoutes {
		bip, bipNet, err := net.ParseCIDR(cidr)
		if err != nil || bip.To4() == nil || gw == "" {
			continue
		}
		o, b := bipNet.Mask.Size()
		dest := bip.Mask(bipNet.Mask).String()
		mask := net.IP(net.CIDRMask(o, b)).String()
		_, _ = runCmd(1*time.Second, "route", "delete", dest, "mask", mask)
		_, _ = runCmd(2*time.Second, "route", "add", dest, "mask", mask, gw)
	}

	// Split-default через IP туннеля (как у WireGuard for Windows)
	delIfaceRoute("0.0.0.0", "128.0.0.0", ifIndex)
	delIfaceRoute("128.0.0.0", "128.0.0.0", ifIndex)
	if err := addIfaceRoute("0.0.0.0", "128.0.0.0", tunIP, ifIndex); err != nil {
		return err
	}
	if err := addIfaceRoute("128.0.0.0", "128.0.0.0", tunIP, ifIndex); err != nil {
		return err
	}

	if netGen.Load() != gen {
		return fmt.Errorf("cancelled")
	}

	// DNS только после рабочих маршрутов — иначе «нет интернета»
	if len(cfg.DNS) > 0 {
		_, _ = runCmd(2*time.Second, "netsh", "interface", "ipv4", "set", "dnsservers",
			"name="+iface, "source=static", "address="+cfg.DNS[0],
			"register=none", "validate=no")
		_, _ = runCmd(1*time.Second, "ipconfig", "/flushdns")
	}

	logf("routes ok ifIndex=%d tunIP=%s gw=%s", ifIndex, tunIP, gw)
	return nil
}

func clearNetConfig(iface string, _ tun.Device, cfg *netConfig, myGen uint64) {
	ifIndex, _ := ifIndexByName(iface)
	delIfaceRoute("0.0.0.0", "128.0.0.0", ifIndex)
	delIfaceRoute("128.0.0.0", "128.0.0.0", ifIndex)
	delIfaceRoute("0.0.0.0", "0.0.0.0", ifIndex)

	if host, _, err := splitHostPort(cfg.Endpoint); err == nil {
		_, _ = runCmd(1*time.Second, "route", "delete", host)
	}
	for _, cidr := range cfg.BypassRoutes {
		bip, bipNet, err := net.ParseCIDR(cidr)
		if err != nil || bip.To4() == nil {
			continue
		}
		o, b := bipNet.Mask.Size()
		dest := bip.Mask(bipNet.Mask).String()
		mask := net.IP(net.CIDRMask(o, b)).String()
		_, _ = runCmd(1*time.Second, "route", "delete", dest, "mask", mask)
	}
	if netGen.Load() != myGen {
		return
	}
	_, _ = runCmd(2*time.Second, "netsh", "interface", "ipv4", "set", "dnsservers",
		"name="+iface, "source=dhcp")
	_, _ = runCmd(1*time.Second, "ipconfig", "/flushdns")
}
