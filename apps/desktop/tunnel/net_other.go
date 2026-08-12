//go:build !windows && !darwin

package main

import (
	"fmt"

	"golang.zx2c4.com/wireguard/tun"
)

func applyNetConfig(iface string, _ tun.Device, cfg *netConfig) error {
	_ = cfg
	return fmt.Errorf("platform not supported for tunnel net config (%s)", iface)
}

func clearNetConfig(iface string, _ tun.Device, cfg *netConfig, _ uint64) {
	_ = iface
	_ = cfg
}
