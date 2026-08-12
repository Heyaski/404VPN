//go:build !windows

package main

import "golang.zx2c4.com/wireguard/tun"

func createTunDevice(name string, mtu int) (tun.Device, error) {
	return tun.CreateTUN(name, mtu)
}
