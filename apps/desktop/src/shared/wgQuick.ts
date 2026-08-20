import type { TunnelConfig } from "./types.js";

export function isFilterAvailable(config: TunnelConfig): boolean {
  return config.dnsFiltered.length > 0;
}

/**
 * Payload для Go-helper.
 * AllowedIPs в WG — полный туннель (0.0.0.0/0).
 * Обход LAN (bypassRoutes) ставится как 2–3 OS-маршрута через обычный шлюз —
 * не через allowedIPsExcluding (десятки route add = минута ожидания).
 */
export function buildHelperPayload(config: TunnelConfig, dnsFilter: boolean) {
  const resolvers =
    dnsFilter && isFilterAvailable(config) ? config.dnsFiltered : config.dns;

  return {
    privateKey: config.privateKey,
    address: config.address,
    dns: resolvers,
    bypassRoutes: config.bypassRoutes ?? [],
    peer: {
      publicKey: config.peer.publicKey,
      ...(config.peer.presharedKey
        ? { presharedKey: config.peer.presharedKey }
        : {}),
      endpoint: config.peer.endpoint,
      allowedIps: ["0.0.0.0/0"],
      // Без keepalive NAT/CGNAT часто убивает UDP — туннель «висит», пока не reconnect.
      persistentKeepalive: config.peer.persistentKeepalive ?? 25,
    },
  };
}
