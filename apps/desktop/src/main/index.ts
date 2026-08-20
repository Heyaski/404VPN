import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  Tray,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "./api.js";
import { ApiClientError } from "./api.js";
import { isElevated, relaunchElevated } from "./elevate.js";
import { loadPreferences, savePreferences, type Preferences } from "./preferences.js";
import { clearToken, loadToken, saveToken } from "./tokenStore.js";
import { TunnelManager } from "./tunnelManager.js";
import { isFilterAvailable } from "../shared/wgQuick.js";
import type { MeResponse, TunnelConfig } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Одна копия приложения. Иначе плодятся 404VPN.exe и zombie tunnel-helper.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}

const tunnel = new TunnelManager();
let cachedTunnel: TunnelConfig | null = null;
let cachedTunnelAt = 0;
let prefs = loadPreferences();

function tunnelCacheFresh(): boolean {
  return cachedTunnel != null && Date.now() - cachedTunnelAt < 60_000;
}

async function fetchTunnelConfig(force = false): Promise<TunnelConfig> {
  if (!force && tunnelCacheFresh() && cachedTunnel) return cachedTunnel;
  const config = await api.tunnel();
  cachedTunnel = config;
  cachedTunnelAt = Date.now();
  return config;
}

function resolveIcon(): string | undefined {
  const candidates = [
    // .ico лучше для трея Windows
    path.join(process.resourcesPath, "icon.ico"),
    path.join(__dirname, "../../build/icon.ico"),
    path.join(app.getAppPath(), "build/icon.ico"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "../../build/icon.png"),
    path.join(app.getAppPath(), "build/icon.png"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function loadAppIcon() {
  const iconPath = resolveIcon();
  if (!iconPath) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) return img;
  // Трей Windows ожидает ~16–32px
  return img.resize({ width: 16, height: 16 });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu(): void {
  if (!tray) return;
  const status = tunnel.getStatus();
  const statusLabel =
    status === "connected"
      ? "Статус: подключено"
      : status === "connecting"
        ? "Статус: подключение…"
        : status === "error"
          ? "Статус: ошибка"
          : "Статус: отключено";

  tray.setToolTip(
    status === "connected" ? "404VPN — подключено" : "404VPN",
  );

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "404VPN", enabled: false },
      { label: statusLabel, enabled: false },
      { type: "separator" },
      {
        label: "Открыть",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "Выход",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray(): void {
  if (tray) return;
  const icon = loadAppIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("404VPN");
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
  updateTrayMenu();

  // Обновлять подпись при смене статуса туннеля
  const tick = () => updateTrayMenu();
  setInterval(tick, 2000);
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return;
  }

  const iconPath = resolveIcon();
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 380,
    minHeight: 600,
    title: "404VPN",
    backgroundColor: "#070B14",
    autoHideMenuBar: true,
    ...(iconPath
      ? { icon: nativeImage.createFromPath(iconPath) }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
  });

  // Крестик — свернуть в трей, не закрывать VPN
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    void win.loadURL("http://127.0.0.1:5174");
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function deviceName(): string {
  const host = os.hostname() || "PC";
  if (process.platform === "darwin") return host;
  if (process.platform === "win32") return `Windows · ${host}`;
  return host;
}

function mapError(e: unknown): { message: string; code?: string } {
  if (e instanceof ApiClientError) return { message: e.message, code: e.code };
  if (e instanceof Error) return { message: e.message };
  return { message: "Неизвестная ошибка" };
}

app.whenReady().then(() => {
  if (!gotLock) return;

  // Стереть устаревший лог-«ошибку» с прошлого сеанса
  tunnel.clearLastError();

  createTray();
  createWindow();

  // Прогрев Wintun в фоне — первый Connect без ожидания драйвера
  void tunnel.warmup();
  // Подтянуть конфиг заранее, если уже есть токен
  if (loadToken()) {
    void fetchTunnelConfig().catch(() => undefined);
  }

  // После сна/гибернации маршруты и NAT часто «отваливаются»
  powerMonitor.on("resume", () => {
    tunnel.onSystemResume();
  });

  app.on("activate", () => {
    showMainWindow();
  });

  // Автоподключение только если уже admin — иначе сразу ERROR без текста.
  void (async () => {
    if (!prefs.autoConnect || !loadToken()) return;
    if (process.platform === "win32" && !isElevated()) return;
    try {
      const me = await api.me();
      if (me.status !== "active") return;
      const config = await fetchTunnelConfig();
      await tunnel.connect(config, prefs.dnsFilter && isFilterAvailable(config));
      updateTrayMenu();
    } catch (e) {
      console.error("auto-connect failed", e);
      updateTrayMenu();
    }
  })();
});

app.on("window-all-closed", () => {
  // Не выходим: крестик прячет окно, процесс живёт с иконкой в трее.
  // Выход только через меню трея «Выход» (isQuitting).
  if (isQuitting && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  void tunnel.shutdown();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

ipcMain.handle("app:hasToken", () => loadToken() != null);

ipcMain.handle("app:getPreferences", () => prefs);

ipcMain.handle("app:setPreferences", (_e, next: Preferences) => {
  prefs = { ...prefs, ...next };
  savePreferences(prefs);
  return prefs;
});

ipcMain.handle("app:redeem", async (_e, code: string) => {
  try {
    const res = await api.redeem(code, deviceName());
    saveToken(res.token);
    return { ok: true as const, data: res };
  } catch (e) {
    const err = mapError(e);
    return { ok: false as const, ...err };
  }
});

ipcMain.handle("app:me", async () => {
  try {
    const data: MeResponse = await api.me();
    return { ok: true as const, data };
  } catch (e) {
    const err = mapError(e);
    if (err.code === "unauthorized" || (e instanceof ApiClientError && e.status === 401)) {
      clearToken();
    }
    return { ok: false as const, ...err };
  }
});

ipcMain.handle("vpn:status", () => tunnel.getStatus());
ipcMain.handle("vpn:lastError", () => tunnel.getLastError());

ipcMain.handle("vpn:connect", async () => {
  try {
    if (process.platform === "win32" && !app.isPackaged && !isElevated()) {
      return {
        ok: false as const,
        code: "need_admin",
        message:
          "Нужны права администратора. Закрой приложение и запусти снова с подтверждением Windows.",
      };
    }

    // Сначала кэш конфига — без ожидания сети UI поднимает туннель сразу
    let config: TunnelConfig;
    if (tunnelCacheFresh() && cachedTunnel) {
      config = cachedTunnel;
      void api.me().catch(() => undefined);
      void fetchTunnelConfig(true).catch(() => undefined);
    } else {
      const mePromise = api.me();
      const configPromise = fetchTunnelConfig();
      const me = await mePromise;
      if (me.status === "blocked") {
        return { ok: false as const, message: mapError(new ApiClientError("blocked", 403)).message, code: "blocked" };
      }
      if (me.status !== "active") {
        return { ok: false as const, message: mapError(new ApiClientError("suspended", 402)).message, code: "suspended" };
      }
      config = await configPromise;
    }

    await tunnel.connect(config, prefs.dnsFilter && isFilterAvailable(config));
    updateTrayMenu();
    return {
      ok: true as const,
      filterAvailable: isFilterAvailable(config),
    };
  } catch (e) {
    updateTrayMenu();
    const err = mapError(e);
    const fallback = tunnel.getLastError();
    return {
      ok: false as const,
      message: err.message || fallback || "Не удалось подключить туннель",
      code: err.code,
    };
  }
});

ipcMain.handle("app:relaunchElevated", () => {
  if (!relaunchElevated()) {
    return { ok: false as const, message: "Не удалось запросить права администратора" };
  }
  // Старое окно НЕ закрываем: elevate иногда не поднимает новый процесс,
  // и пользователь остаётся ни с чем. Закрой старое сам, если откроется второе.
  return {
    ok: true as const,
    message: "Подтверди UAC. Должно открыться новое окно 404VPN — работай в нём.",
  };
});

ipcMain.handle("app:isElevated", () => isElevated());

ipcMain.handle("vpn:disconnect", async () => {
  try {
    await tunnel.disconnect();
    updateTrayMenu();
    return { ok: true as const };
  } catch (e) {
    updateTrayMenu();
    return { ok: false as const, ...mapError(e) };
  }
});

ipcMain.handle("vpn:stats", async () => {
  try {
    return { ok: true as const, data: await tunnel.stats() };
  } catch {
    return { ok: true as const, data: { rxBytes: 0, txBytes: 0 } };
  }
});

ipcMain.handle("vpn:setDnsFilter", async (_e, enabled: boolean) => {
  prefs = { ...prefs, dnsFilter: enabled };
  savePreferences(prefs);
  if (tunnel.getStatus() !== "connected") {
    return { ok: true as const, prefs };
  }
  try {
    const config = cachedTunnel ?? (await api.tunnel());
    cachedTunnel = config;
    if (!isFilterAvailable(config)) {
      prefs = { ...prefs, dnsFilter: false };
      savePreferences(prefs);
      return {
        ok: false as const,
        message: "Фильтр DNS на сервере не настроен",
        prefs,
      };
    }
    await tunnel.disconnect();
    await tunnel.connect(config, enabled);
    return { ok: true as const, prefs };
  } catch (e) {
    return { ok: false as const, ...mapError(e), prefs };
  }
});

ipcMain.handle("app:unlink", async () => {
  try {
    await tunnel.disconnect().catch(() => undefined);
    await api.revokeDevice().catch(() => undefined);
  } finally {
    clearToken();
    cachedTunnel = null;
  }
  return { ok: true as const };
});

ipcMain.handle("app:openExternal", (_e, url: string) => {
  void shell.openExternal(url);
});
