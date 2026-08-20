import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildHelperPayload } from "../shared/wgQuick.js";
import type { HelperUpPayload, TunnelConfig, TunnelStats, VpnStatus } from "../shared/types.js";

type HelperResponse = {
  ok: boolean;
  error?: string;
  status?: VpnStatus;
  stats?: TunnelStats;
};

/** WireGuard считает пир «мёртвым», если handshake старше ~180с. Берём с запасом. */
const HANDSHAKE_STALE_SEC = 150;
/** После connect даём время на первый handshake. */
const HANDSHAKE_GRACE_MS = 30_000;
const WATCHDOG_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 3;

export class TunnelManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<
    number,
    { resolve: (v: HelperResponse) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private buffer = "";
  private status: VpnStatus = "disconnected";
  private lastConfig: TunnelConfig | null = null;
  private lastDnsFilter = false;
  private lastError: string | null = null;
  private stderrBuf = "";
  private intentionalStop = false;

  /** Пользователь хочет, чтобы VPN был включён (для авто-reconnect). */
  private wantConnected = false;
  private connectedAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;

  getStatus(): VpnStatus {
    return this.status;
  }

  getLastError(): string | null {
    if (this.lastError) return this.lastError;
    try {
      const file = path.join(app.getPath("userData"), "tunnel-last-error.txt");
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, "utf8").trim();
      const lines = raw.split(/\r?\n/).filter(Boolean);
      const body = lines.length >= 2 ? lines.slice(1).join("\n") : lines[0] ?? null;
      return sanitizeError(body);
    } catch {
      return null;
    }
  }

  clearLastError(): void {
    this.lastError = null;
    try {
      const file = path.join(app.getPath("userData"), "tunnel-last-error.txt");
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }

  getLastConfig(): TunnelConfig | null {
    return this.lastConfig;
  }

  private helperPath(): string {
    const name = process.platform === "win32" ? "tunnel-helper.exe" : "tunnel-helper";
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "tunnel", name);
    }
    return path.join(app.getAppPath(), "tunnel", "dist", name);
  }

  private persistError(msg: string): void {
    const clean = sanitizeError(msg) ?? "Не удалось подключить туннель";
    this.lastError = clean;
    try {
      fs.writeFileSync(
        path.join(app.getPath("userData"), "tunnel-last-error.txt"),
        `${new Date().toISOString()}\n${clean}\n`,
        "utf8",
      );
    } catch {
      /* ignore */
    }
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;

    const bin = this.helperPath();
    if (!fs.existsSync(bin)) {
      throw new Error(
        `Модуль туннеля не найден: ${bin}. Переустанови 404VPN.`,
      );
    }

    this.intentionalStop = false;
    const child = spawn(bin, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd: path.dirname(bin),
      env: {
        ...process.env,
        PATH: `${path.dirname(bin)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    this.child = child;
    this.stderrBuf = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as HelperResponse & { id?: number };
          if (typeof msg.id === "number") {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              p.resolve(msg);
            }
          }
        } catch {
          /* ignore malformed */
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuf += chunk;
      console.error("[tunnel-helper]", chunk.trim());
    });

    child.on("exit", (code) => {
      this.child = null;
      if (this.intentionalStop) {
        this.pending.clear();
        return;
      }
      const why =
        sanitizeError(this.stderrBuf) ||
        `Модуль туннеля аварийно завершился (код ${code ?? "?"}). Запусти 404VPN снова.`;
      this.persistError(why);
      for (const [, p] of this.pending) {
        p.reject(new Error(why));
      }
      this.pending.clear();
      if (this.status === "connected" || this.status === "connecting") {
        this.setStatus("disconnected");
      }
      // Helper упал, но пользователь хотел VPN — попробуем поднять снова
      if (this.wantConnected && this.lastConfig && !this.reconnecting) {
        void this.recover("helper-exit");
      }
    });

    return child;
  }

  private send(cmd: string, payload?: unknown, timeoutMs = 12_000): Promise<HelperResponse> {
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const line = JSON.stringify({ id, cmd, payload }) + "\n";
      child.stdin.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Таймаут модуля туннеля. Попробуй ещё раз."));
        }
      }, timeoutMs);
    });
  }

  private setStatus(status: VpnStatus): void {
    this.status = status;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("vpn:status", status);
    }
  }

  /** Если UI уже отвалился по таймауту, а helper успел поднять туннель — доверяем факту. */
  private async probeConnected(): Promise<boolean> {
    try {
      const st = await this.send("status", undefined, 4_000);
      return Boolean(st.ok && st.status === "connected");
    } catch {
      return false;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      void this.watchdogTick();
    }, WATCHDOG_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async watchdogTick(): Promise<void> {
    if (!this.wantConnected || this.reconnecting) return;
    if (this.status === "connecting" || this.status === "disconnecting") return;

    // После неудачного reconnect статус может быть не connected — пробуем снова
    if (this.status !== "connected") {
      await this.recover("want-connected");
      return;
    }

    try {
      const res = await this.send("stats", undefined, 4_000);
      // Старый helper без lastHandshakeSec — не дёргаем reconnect по ложному 0
      if (res.stats == null || res.stats.lastHandshakeSec === undefined) {
        return;
      }
      const hs = res.stats.lastHandshakeSec;
      const upFor = Date.now() - this.connectedAt;
      const ageSec = hs > 0 ? Math.floor(Date.now() / 1000) - hs : null;

      let unhealthy = false;
      if (hs === 0 && upFor > HANDSHAKE_GRACE_MS) {
        unhealthy = true;
      } else if (ageSec != null && ageSec > HANDSHAKE_STALE_SEC) {
        unhealthy = true;
      }

      if (unhealthy) {
        console.warn("[tunnel] unhealthy handshake", { hs, ageSec, upFor });
        await this.recover("stale-handshake");
      }
    } catch (e) {
      console.warn("[tunnel] watchdog stats failed", e);
      await this.recover("stats-failed");
    }
  }

  /**
   * Сон / смена сети: маршруты и NAT часто умирают, UI остаётся «подключено».
   * Через пару секунд форсируем проверку / reconnect.
   */
  onSystemResume(): void {
    if (!this.wantConnected || !this.lastConfig) return;
    console.warn("[tunnel] system resume — health check soon");
    setTimeout(() => {
      void this.watchdogTick();
    }, 3_000);
  }

  private async recover(reason: string): Promise<void> {
    if (!this.wantConnected || !this.lastConfig || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error("[tunnel] reconnect gave up after", reason);
      this.persistError("Соединение потеряно. Нажми «Подключить» ещё раз.");
      this.wantConnected = false;
      this.stopWatchdog();
      this.setStatus("error");
      this.reconnecting = false;
      return;
    }

    console.warn(
      `[tunnel] reconnect ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} (${reason})`,
    );
    this.setStatus("connecting");

    try {
      try {
        await Promise.race([
          this.send("down", undefined, 5_000),
          new Promise<HelperResponse>((_, reject) =>
            setTimeout(() => reject(new Error("down timeout")), 5_000),
          ),
        ]);
      } catch {
        /* continue — up перезатрёт */
      }

      await sleep(400 * this.reconnectAttempts);

      const payload: HelperUpPayload = buildHelperPayload(
        this.lastConfig,
        this.lastDnsFilter,
      );
      const res = await this.send("up", payload, 90_000);
      if (!res.ok) throw new Error(humanizeTunnelError(res.error));

      this.clearLastError();
      this.connectedAt = Date.now();
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.startWatchdog();
    } catch (e) {
      console.error("[tunnel] reconnect failed", e);
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.persistError(
          e instanceof Error
            ? humanizeTunnelError(e.message)
            : "Соединение потеряно. Нажми «Подключить» ещё раз.",
        );
        this.wantConnected = false;
        this.stopWatchdog();
        this.setStatus("error");
      } else {
        // Следующий тик watchdog снова вызовет recover
        this.setStatus("disconnected");
      }
    } finally {
      this.reconnecting = false;
    }
  }

  async warmup(): Promise<void> {
    try {
      await this.send("warmup", undefined, 60_000);
    } catch (e) {
      console.error("tunnel warmup failed", e);
    }
  }

  async connect(config: TunnelConfig, dnsFilter: boolean): Promise<void> {
    this.lastConfig = config;
    this.lastDnsFilter = dnsFilter;
    this.wantConnected = true;
    this.reconnectAttempts = 0;
    this.clearLastError();
    this.setStatus("connecting");
    const payload: HelperUpPayload = buildHelperPayload(config, dnsFilter);
    try {
      const res = await this.send("up", payload, 90_000);
      if (!res.ok) throw new Error(humanizeTunnelError(res.error));
      this.clearLastError();
      this.connectedAt = Date.now();
      this.setStatus("connected");
      this.startWatchdog();
    } catch (e) {
      if (await this.probeConnected()) {
        this.clearLastError();
        this.connectedAt = Date.now();
        this.setStatus("connected");
        this.startWatchdog();
        return;
      }
      this.wantConnected = false;
      this.stopWatchdog();
      this.setStatus("error");
      const msg =
        e instanceof Error
          ? humanizeTunnelError(e.message)
          : "Не удалось подключить туннель";
      this.persistError(msg);
      throw new Error(msg);
    }
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.stopWatchdog();
    this.reconnectAttempts = 0;
    this.setStatus("disconnecting");
    try {
      if (this.child) {
        await Promise.race([
          this.send("down"),
          new Promise<HelperResponse>((_, reject) =>
            setTimeout(() => reject(new Error("down timeout")), 3000),
          ),
        ]);
      }
    } catch {
      /* всё равно считаем отключённым */
    } finally {
      this.clearLastError();
      this.setStatus("disconnected");
    }
  }

  async stats(): Promise<TunnelStats> {
    if (this.status !== "connected") return { rxBytes: 0, txBytes: 0 };
    const res = await this.send("stats");
    return res.stats ?? { rxBytes: 0, txBytes: 0 };
  }

  async shutdown(): Promise<void> {
    this.wantConnected = false;
    this.stopWatchdog();
    this.intentionalStop = true;
    try {
      await this.disconnect();
    } catch {
      /* ignore */
    }
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
      this.child = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Не показывать сырые логи helper'а пользователю. */
function sanitizeError(raw?: string | null): string | null {
  if (!raw) return null;
  const msg = raw.trim();
  if (!msg) return null;
  if (
    msg.includes("[tunnel-helper]") ||
    msg.includes("Using existing driver") ||
    msg.includes("Creating adapter") ||
    msg.includes("cleanup stale") ||
    msg.includes("apply net") ||
    msg.includes("warmup") ||
    msg.includes("handshake pending") ||
    msg.includes("routes ok") ||
    /^\[/m.test(msg)
  ) {
    return null;
  }
  return msg;
}

function humanizeTunnelError(raw?: string): string {
  const sanitized = sanitizeError(raw);
  const msg = sanitized || "Не удалось подключить туннель";
  const low = msg.toLowerCase();
  if (
    low.includes("access is denied") ||
    low.includes("denied") ||
    low.includes("privileges") ||
    low.includes("administrator") ||
    low.includes("elevation") ||
    (low.includes("create tun") && low.includes("5"))
  ) {
    return "Нужны права администратора. Закрой приложение и запусти снова — подтверди запрос Windows.";
  }
  if (low.includes("wintun") || low.includes("cannot load") || low.includes("dll")) {
    return "Не найден системный модуль туннеля. Переустанови 404VPN.";
  }
  if (low.includes("уже существует") || low.includes("already exists")) {
    return "Сетевой адаптер 404VPN занят. Перезагрузи ПК и попробуй снова.";
  }
  return msg;
}
