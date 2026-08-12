//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"golang.zx2c4.com/wireguard/tun"
)

// Стабильный GUID — Windows переиспользует тот же адаптер, а не плодит 404vpn 1/2/3.
var adapterGUID = &windows.GUID{
	Data1: 0x40440440,
	Data2: 0x4040,
	Data3: 0x4040,
	Data4: [8]byte{0x40, 0x4e, 0x40, 0x40, 0x40, 0x40, 0x40, 0x40},
}

func init() {
	// Чтобы в системе не светилось имя WireGuard.
	tun.WintunTunnelType = "404VPN"
}

func createTunDevice(name string, mtu int) (tun.Device, error) {
	return tun.CreateTUNWithRequestedGUID(name, adapterGUID, mtu)
}
