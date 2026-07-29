import { parseWgConf, type TunnelConfig, type WgClient, type WgProvider } from "./provider.js";

/**
 * Драйвер wg-easy v14 (ghcr.io/wg-easy/wg-easy:14).
 * API: POST /api/session (пароль → cookie), CRUD по /api/wireguard/client.
 * Создание клиента в v14 не возвращает тело — id находим по имени в списке.
 */
export class WgEasyProvider implements WgProvider {
  private cookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly password: string,
    private readonly endpointHost?: string,
  ) {}

  private async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: this.password }),
    });
    if (!res.ok) throw new Error(`wg-easy login failed: ${res.status}`);
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) throw new Error("wg-easy login returned no session cookie");
    this.cookie = setCookie.split(";")[0];
  }

  /** Выполняет запрос, перелогиниваясь один раз при истёкшей сессии. */
  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.cookie) await this.login();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Cookie: this.cookie!, ...init.headers },
    });
    if (res.status === 401 && retry) {
      this.cookie = null;
      return this.request(path, init, false);
    }
    if (!res.ok) throw new Error(`wg-easy ${init.method ?? "GET"} ${path} → ${res.status}`);
    return res;
  }

  async listClients(): Promise<WgClient[]> {
    const res = await this.request("/api/wireguard/client");
    const raw = (await res.json()) as { id: string; name: string; enabled: boolean }[];
    return raw.map((c) => ({ clientId: c.id, name: c.name, enabled: c.enabled }));
  }

  async createClient(name: string): Promise<{ clientId: string; publicKey: string; tunnel: TunnelConfig }> {
    await this.request("/api/wireguard/client", { method: "POST", body: JSON.stringify({ name }) });

    // v14 отдаёт 204 без тела — ищем созданного клиента по имени (берём самого свежего)
    const res = await this.request("/api/wireguard/client");
    const all = (await res.json()) as { id: string; name: string; publicKey: string; createdAt: string }[];
    const matching = all.filter((c) => c.name === name);
    if (matching.length === 0) throw new Error(`wg-easy: client "${name}" not found after create`);
    const created = matching.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

    const confRes = await this.request(`/api/wireguard/client/${created.id}/configuration`);
    const tunnel = parseWgConf(await confRes.text(), this.endpointHost);
    return { clientId: created.id, publicKey: created.publicKey, tunnel };
  }

  async getTunnel(clientId: string): Promise<TunnelConfig> {
    const res = await this.request(`/api/wireguard/client/${clientId}/configuration`);
    return parseWgConf(await res.text(), this.endpointHost);
  }

  async deleteClient(clientId: string): Promise<void> {
    await this.request(`/api/wireguard/client/${clientId}`, { method: "DELETE" });
  }

  async setEnabled(clientId: string, enabled: boolean): Promise<void> {
    await this.request(`/api/wireguard/client/${clientId}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
    });
  }
}
