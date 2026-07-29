export interface TunnelConfig {
  privateKey: string;
  address: string; // 10.8.0.5/24
  dns: string[];
  peer: {
    publicKey: string;
    presharedKey?: string;
    endpoint: string; // host:51820
    allowedIps: string[];
    persistentKeepalive?: number;
  };
}

export interface WgClient {
  clientId: string;
  name: string;
  enabled: boolean;
}

export interface WgProvider {
  createClient(name: string): Promise<{ clientId: string; publicKey: string; tunnel: TunnelConfig }>;
  /** Конфиг уже созданного клиента. Приватный ключ у себя не храним — забираем по запросу. */
  getTunnel(clientId: string): Promise<TunnelConfig>;
  deleteClient(clientId: string): Promise<void>;
  setEnabled(clientId: string, enabled: boolean): Promise<void>;
  listClients(): Promise<WgClient[]>;
}

export class WgNotConfiguredError extends Error {
  constructor() {
    super("wg_not_configured");
  }
}

/** Заглушка на случай, когда wg-easy не настроен: бот и платежи работают, туннели — нет. */
export class NullWgProvider implements WgProvider {
  async createClient(): Promise<never> {
    throw new WgNotConfiguredError();
  }
  async getTunnel(): Promise<never> {
    throw new WgNotConfiguredError();
  }
  async deleteClient(): Promise<never> {
    throw new WgNotConfiguredError();
  }
  async setEnabled(): Promise<never> {
    throw new WgNotConfiguredError();
  }
  async listClients(): Promise<never> {
    throw new WgNotConfiguredError();
  }
}

/**
 * Разбирает .conf WireGuard (то, что отдаёт wg-easy) в структуру для приложения.
 * Чистая функция — тестируется без сети.
 */
export function parseWgConf(conf: string, endpointHostOverride?: string): TunnelConfig {
  const section: Record<string, Record<string, string>> = {};
  let current = "";
  for (const raw of conf.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) {
      current = header[1].toLowerCase();
      section[current] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1 || !current) continue;
    section[current][line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }

  const iface = section.interface ?? {};
  const peer = section.peer ?? {};
  const endpoint = peer.endpoint ?? "";
  const endpointPort = endpoint.includes(":") ? endpoint.slice(endpoint.lastIndexOf(":") + 1) : "51820";

  return {
    privateKey: iface.privatekey ?? "",
    address: iface.address ?? "",
    dns: (iface.dns ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    peer: {
      publicKey: peer.publickey ?? "",
      presharedKey: peer.presharedkey || undefined,
      endpoint: endpointHostOverride ? `${endpointHostOverride}:${endpointPort}` : endpoint,
      allowedIps: (peer.allowedips ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      persistentKeepalive: peer.persistentkeepalive ? Number(peer.persistentkeepalive) : undefined,
    },
  };
}
