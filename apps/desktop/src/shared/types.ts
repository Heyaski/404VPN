export interface TunnelPeer {
  publicKey: string;
  presharedKey?: string | null;
  endpoint: string;
  allowedIps: string[];
  persistentKeepalive?: number | null;
}

export interface TunnelConfig {
  privateKey: string;
  address: string;
  dns: string[];
  dnsFiltered: string[];
  bypassRoutes: string[];
  peer: TunnelPeer;
}

export interface RedeemResponse {
  token: string;
  balance: string;
  daysLeft: number | null;
}

export interface MeResponse {
  balance: string;
  status: string;
  devices: number;
  deviceName: string | null;
  daysLeft: number | null;
}

export type VpnStatus = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";

export interface TunnelStats {
  rxBytes: number;
  txBytes: number;
}

export interface HelperUpPayload {
  privateKey: string;
  address: string;
  dns: string[];
  bypassRoutes: string[];
  peer: {
    publicKey: string;
    presharedKey?: string;
    endpoint: string;
    allowedIps: string[];
    persistentKeepalive?: number;
  };
}

export type ApiErrorCode =
  | "invalid_code"
  | "already_used"
  | "expired"
  | "revoked"
  | "too_many_attempts"
  | "device_limit"
  | "suspended"
  | "blocked"
  | "unauthorized"
  | "wg_unavailable"
  | "network";
