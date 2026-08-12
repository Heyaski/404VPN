import { contextBridge, ipcRenderer } from "electron";
import type { MeResponse, RedeemResponse, TunnelStats, VpnStatus } from "../shared/types.js";

export interface Preferences {
  dnsFilter: boolean;
  autoConnect: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; message: string; code?: string };
type VoidResult = { ok: true } | { ok: false; message: string; code?: string };

const api = {
  hasToken: (): Promise<boolean> => ipcRenderer.invoke("app:hasToken"),
  getPreferences: (): Promise<Preferences> => ipcRenderer.invoke("app:getPreferences"),
  setPreferences: (prefs: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke("app:setPreferences", prefs),
  redeem: (code: string): Promise<Result<RedeemResponse>> =>
    ipcRenderer.invoke("app:redeem", code),
  me: (): Promise<Result<MeResponse>> => ipcRenderer.invoke("app:me"),
  vpnStatus: (): Promise<VpnStatus> => ipcRenderer.invoke("vpn:status"),
  lastError: (): Promise<string | null> => ipcRenderer.invoke("vpn:lastError"),
  connect: (): Promise<
    | { ok: true; filterAvailable: boolean }
    | { ok: false; message: string; code?: string }
  > => ipcRenderer.invoke("vpn:connect"),
  disconnect: (): Promise<VoidResult> => ipcRenderer.invoke("vpn:disconnect"),
  stats: (): Promise<{ ok: true; data: TunnelStats }> => ipcRenderer.invoke("vpn:stats"),
  setDnsFilter: (
    enabled: boolean,
  ): Promise<
    | { ok: true; prefs: Preferences }
    | { ok: false; message: string; prefs: Preferences }
  > => ipcRenderer.invoke("vpn:setDnsFilter", enabled),
  unlink: (): Promise<VoidResult> => ipcRenderer.invoke("app:unlink"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:openExternal", url),
  isElevated: (): Promise<boolean> => ipcRenderer.invoke("app:isElevated"),
  relaunchElevated: (): Promise<
    { ok: true; message?: string } | { ok: false; message: string }
  > => ipcRenderer.invoke("app:relaunchElevated"),
  onStatus: (cb: (status: VpnStatus) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: VpnStatus) => cb(status);
    ipcRenderer.on("vpn:status", handler);
    return () => ipcRenderer.removeListener("vpn:status", handler);
  },
};

contextBridge.exposeInMainWorld("overlay", api);

export type OverlayApi = typeof api;
