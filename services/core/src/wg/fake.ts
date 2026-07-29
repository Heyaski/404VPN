import type { TunnelConfig, WgClient, WgProvider } from "./provider.js";

/** Провайдер для тестов: держит клиентов в памяти и считает вызовы. */
export class FakeWgProvider implements WgProvider {
  clients = new Map<string, WgClient>();
  calls: string[] = [];
  private seq = 0;

  async createClient(name: string): Promise<{ clientId: string; publicKey: string; tunnel: TunnelConfig }> {
    this.calls.push(`create:${name}`);
    const clientId = `client-${++this.seq}`;
    this.clients.set(clientId, { clientId, name, enabled: true });
    return {
      clientId,
      publicKey: `pub-${this.seq}`,
      tunnel: {
        privateKey: `priv-${this.seq}`,
        address: `10.8.0.${this.seq + 1}/24`,
        dns: ["1.1.1.1"],
        peer: {
          publicKey: "server-pub",
          endpoint: "vpn.example:51820",
          allowedIps: ["0.0.0.0/0", "::/0"],
          persistentKeepalive: 25,
        },
      },
    };
  }

  async getTunnel(clientId: string): Promise<TunnelConfig> {
    this.calls.push(`tunnel:${clientId}`);
    const n = clientId.replace("client-", "");
    return {
      privateKey: `priv-${n}`,
      address: `10.8.0.${Number(n) + 1}/24`,
      dns: ["1.1.1.1"],
      peer: {
        publicKey: "server-pub",
        endpoint: "vpn.example:51820",
        allowedIps: ["0.0.0.0/0", "::/0"],
        persistentKeepalive: 25,
      },
    };
  }

  async deleteClient(clientId: string): Promise<void> {
    this.calls.push(`delete:${clientId}`);
    this.clients.delete(clientId);
  }

  async setEnabled(clientId: string, enabled: boolean): Promise<void> {
    this.calls.push(`${enabled ? "enable" : "disable"}:${clientId}`);
    const c = this.clients.get(clientId);
    if (c) c.enabled = enabled;
  }

  async listClients(): Promise<WgClient[]> {
    return [...this.clients.values()];
  }
}
