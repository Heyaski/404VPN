package main

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun"
)

const ifaceName = "404vpn"

// Поколение сетевых операций — новый Connect отменяет cleanup с Disconnect.
var netGen atomic.Uint64

type tunnel struct {
	mu     sync.Mutex
	dev    *device.Device
	tun    tun.Device
	netCfg *netConfig
	up     bool
}

type netConfig struct {
	Address      string
	DNS          []string
	BypassRoutes []string
	Endpoint     string
	Iface        string
}

func newTunnel() *tunnel {
	return &tunnel{}
}

func (t *tunnel) IsUp() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.up
}

// Warmup создаёт Wintun заранее — первый Connect не ждёт драйвер.
func (t *tunnel) Warmup() (err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in warmup: %v", r)
		}
	}()
	if t.tun != nil {
		return nil
	}
	logf("warmup create tun…")
	tunDev, cerr := createTunDevice(ifaceName, device.DefaultMTU)
	if cerr != nil {
		return fmt.Errorf("create tun: %w", cerr)
	}
	t.tun = tunDev
	logger := device.NewLogger(device.LogLevelError, "")
	t.dev = device.NewDevice(t.tun, conn.NewDefaultBind(), logger)
	logf("warmup ok")
	return nil
}

func (t *tunnel) Up(p upPayload) (err error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic in tunnel up: %v", r)
		}
	}()

	if t.up {
		_ = t.downLocked(true)
	}

	privHex, err := keyToHex(p.PrivateKey)
	if err != nil {
		return err
	}
	pubHex, err := keyToHex(p.Peer.PublicKey)
	if err != nil {
		return err
	}

	realName := ifaceName
	if t.tun == nil {
		logf("create tun…")
		tunDev, cerr := createTunDevice(ifaceName, device.DefaultMTU)
		if cerr != nil {
			return fmt.Errorf("create tun: %w", cerr)
		}
		t.tun = tunDev
	}
	if name, nerr := t.tun.Name(); nerr == nil && name != "" {
		realName = name
	}

	if t.dev == nil {
		logger := device.NewLogger(device.LogLevelError, "")
		t.dev = device.NewDevice(t.tun, conn.NewDefaultBind(), logger)
	}

	// В WG — полный туннель. Обход LAN делаем OS-маршрутами (быстро).
	allowed := p.Peer.AllowedIPs
	if len(allowed) == 0 {
		allowed = []string{"0.0.0.0/0"}
	}

	var b strings.Builder
	fmt.Fprintf(&b, "private_key=%s\n", privHex)
	fmt.Fprintf(&b, "replace_peers=true\n")
	fmt.Fprintf(&b, "public_key=%s\n", pubHex)
	if p.Peer.PresharedKey != "" {
		pskHex, err := keyToHex(p.Peer.PresharedKey)
		if err != nil {
			return err
		}
		fmt.Fprintf(&b, "preshared_key=%s\n", pskHex)
	}
	fmt.Fprintf(&b, "endpoint=%s\n", p.Peer.Endpoint)
	if p.Peer.PersistentKeepalive != nil {
		fmt.Fprintf(&b, "persistent_keepalive_interval=%d\n", *p.Peer.PersistentKeepalive)
	}
	for _, ip := range allowed {
		fmt.Fprintf(&b, "allowed_ip=%s\n", ip)
	}

	if err := t.dev.IpcSet(b.String()); err != nil {
		return fmt.Errorf("ipc set: %w", err)
	}
	if err := t.dev.Up(); err != nil {
		return fmt.Errorf("device up: %w", err)
	}

	cfg := &netConfig{
		Address:      p.Address,
		DNS:          p.DNS,
		BypassRoutes: p.BypassRoutes,
		Endpoint:     p.Peer.Endpoint,
		Iface:        realName,
	}
	logf("apply net %s bypass=%d", realName, len(p.BypassRoutes))
	if err := applyNetConfig(realName, t.tun, cfg); err != nil {
		_ = t.dev.Down()
		return fmt.Errorf("net config: %w", err)
	}

	// Ждём handshake — иначе UI «подключено», а трафик ещё мёртв
	if !waitHandshake(t.dev, 5*time.Second) {
		logf("handshake pending")
	}

	t.netCfg = cfg
	t.up = true
	logf("up ok")
	return nil
}

func waitHandshake(dev *device.Device, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		raw, err := dev.IpcGet()
		if err == nil {
			for _, line := range strings.Split(raw, "\n") {
				if !strings.HasPrefix(line, "last_handshake_time_sec=") {
					continue
				}
				var sec int64
				if _, err := fmt.Sscanf(line, "last_handshake_time_sec=%d", &sec); err == nil && sec > 0 {
					return true
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

func (t *tunnel) Down() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.downLocked(true)
}

func (t *tunnel) downLocked(keepTun bool) error {
	if !t.up && (keepTun || t.dev == nil) {
		if !keepTun {
			t.closeDevice()
		}
		return nil
	}

	cfg := t.netCfg
	tunDev := t.tun
	iface := ifaceName
	if cfg != nil && cfg.Iface != "" {
		iface = cfg.Iface
	}

	myGen := netGen.Add(1)

	if t.dev != nil {
		_ = t.dev.Down()
		if !keepTun {
			t.closeDevice()
			tunDev = nil
		}
	}
	t.netCfg = nil
	t.up = false

	if cfg != nil {
		clearNetConfig(iface, tunDev, cfg, myGen)
	}
	return nil
}

func (t *tunnel) closeDevice() {
	if t.dev != nil {
		t.dev.Close()
		t.dev = nil
		t.tun = nil // Close() закрывает TUN
	}
}

func (t *tunnel) Stats() TunnelStats {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.dev == nil {
		return TunnelStats{}
	}
	raw, err := t.dev.IpcGet()
	if err != nil {
		return TunnelStats{}
	}
	var rx, tx uint64
	for _, line := range strings.Split(raw, "\n") {
		if strings.HasPrefix(line, "rx_bytes=") {
			fmt.Sscanf(line, "rx_bytes=%d", &rx)
		}
		if strings.HasPrefix(line, "tx_bytes=") {
			fmt.Sscanf(line, "tx_bytes=%d", &tx)
		}
	}
	return TunnelStats{RxBytes: rx, TxBytes: tx}
}

func splitHostPort(endpoint string) (host string, port string, err error) {
	return net.SplitHostPort(endpoint)
}
