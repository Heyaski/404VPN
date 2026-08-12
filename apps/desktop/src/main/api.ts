import { API_BASE_URL } from "../shared/config.js";
import { messageForError } from "../shared/errors.js";
import type { MeResponse, RedeemResponse, TunnelConfig } from "../shared/types.js";
import { loadToken } from "./tokenStore.js";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(messageForError(code, status));
    this.name = "ApiClientError";
  }
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    authorized?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { method = "POST", body, authorized = true, timeoutMs = 4000 } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authorized) {
    const token = loadToken();
    if (!token) throw new ApiClientError("unauthorized", 401);
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiClientError("network", 0);
  }

  if (!res.ok) {
    let code = "";
    try {
      const json = (await res.json()) as { error?: string };
      code = json.error ?? "";
    } catch {
      /* ignore */
    }
    throw new ApiClientError(code || "network", res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function redeem(code: string, deviceName: string): Promise<RedeemResponse> {
  return request("/api/redeem", {
    authorized: false,
    body: { code, deviceName },
  });
}

export function me(): Promise<MeResponse> {
  return request("/api/device/me", { method: "GET" });
}

export function tunnel(): Promise<TunnelConfig> {
  return request("/api/device/tunnel");
}

export async function revokeDevice(): Promise<void> {
  await request("/api/device", { method: "DELETE" });
}
