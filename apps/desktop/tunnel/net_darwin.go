//go:build darwin

package main

import (
	"fmt"
	"net"
	"os/exec"
	"strings"

	"golang.zx2c4.com/wireguard/tun"
)

func applyNetConfig(iface string, _ tun.Device, cfg *netConfig) error {
	ip, ipNet, err := net.ParseCIDR(cfg.Address)
	if err != nil {
		return fmt.Errorf("parse address: %w", err)
	}

	if ip.To4() != nil {
		ones, _ := ipNet.Mask.Size()
		cmd := exec.Command("ifconfig", iface, "inet", ip.String(), ip.String(), "prefixlen", fmt.Sprintf("%d", ones), "up")
		if out, err := cmd.CombinedOutput(); err != nil {
			cmd = exec.Command("ifconfig", iface, "inet", cfg.Address, "up")
			if out2, err2 := cmd.CombinedOutput(); err2 != nil {
				return fmt.Errorf("ifconfig: %s / %s (%w)", strings.TrimSpace(string(out)), strings.TrimSpace(string(out2)), err2)
			}
		}
	} else {
		cmd := exec.Command("ifconfig", iface, "inet6", cfg.Address, "up")
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("ifconfig inet6: %s (%w)", strings.TrimSpace(string(out)), err)
		}
	}

	gw := defaultGatewayDarwin()
	if host, _, err := splitHostPort(cfg.Endpoint); err == nil && gw != "" {
		if net.ParseIP(host) != nil {
			_ = exec.Command("route", "-n", "add", "-host", host, gw).Run()
		}
	}
	for _, cidr := range cfg.BypassRoutes {
		if gw == "" {
			break
		}
		_ = exec.Command("route", "-n", "add", "-net", cidr, gw).Run()
	}
	_ = exec.Command("route", "-n", "add", "-net", "0.0.0.0/1", "-iface", iface).Run()
	_ = exec.Command("route", "-n", "add", "-net", "128.0.0.0/1", "-iface", iface).Run()

	if len(cfg.DNS) > 0 {
		if err := setDNSDarwin(cfg.DNS); err != nil {
			return err
		}
	}
	return nil
}

func clearNetConfig(iface string, _ tun.Device, cfg *netConfig, _ uint64) {
	_ = exec.Command("route", "-n", "delete", "-net", "0.0.0.0/1", "-iface", iface).Run()
	_ = exec.Command("route", "-n", "delete", "-net", "128.0.0.0/1", "-iface", iface).Run()
	if host, _, err := splitHostPort(cfg.Endpoint); err == nil {
		_ = exec.Command("route", "-n", "delete", "-host", host).Run()
	}
	for _, cidr := range cfg.BypassRoutes {
		_ = exec.Command("route", "-n", "delete", "-net", cidr).Run()
	}
	_ = clearDNSDarwin()
}

func setDNSDarwin(servers []string) error {
	script := "d.add ServerAddresses * " + strings.Join(servers, " ") + "\n"
	cmd := exec.Command("scutil")
	cmd.Stdin = strings.NewReader("open\nd.init\n" + script + "set State:/Network/Service/404vpn/DNS\nset State:/Network/Global/DNS\nclose\n")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("scutil dns: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	return nil
}

func clearDNSDarwin() error {
	cmd := exec.Command("scutil")
	cmd.Stdin = strings.NewReader("open\nremove State:/Network/Service/404vpn/DNS\nclose\n")
	_ = cmd.Run()
	return nil
}

func defaultGatewayDarwin() string {
	out, err := exec.Command("route", "-n", "get", "default").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "gateway:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "gateway:"))
		}
	}
	return ""
}
