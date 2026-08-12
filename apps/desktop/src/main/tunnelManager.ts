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
  private lastError: string | null = null;
  private stderrBuf = "";
  private intentionalStop = false;

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
      // логи только в консоль, не в UI
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
    });

    return child;
  }

  private send(cmd: string, payload?: unknown): Promise<HelperResponse> {
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
      }, 12_000);
    });
  }

  private setStatus(status: VpnStatus): void {
    this.status = status;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("vpn:status", status);
    }
  }

  async warmup(): Promise<void> {
    try {
      await this.send("warmup");
    } catch (e) {
      console.error("tunnel warmup failed", e);
    }
  }

  async connect(config: TunnelConfig, dnsFilter: boolean): Promise<void> {
    this.lastConfig = config;
    this.clearLastError();
    this.setStatus("connecting");
    const payload: HelperUpPayload = buildHelperPayload(config, dnsFilter);
    try {
      const res = await this.send("up", payload);
      if (!res.ok) throw new Error(humanizeTunnelError(res.error));
      this.clearLastError();
      this.setStatus("connected");
    } catch (e) {
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
    msg.includes("apply net")
  ) {
    // Это диагностический лог, не текст ошибки
    if (!/таймаут|ошибк|error|fail|denied|не удалось/i.test(msg)) {
      return null;
    }
    return "Не удалось подключить туннель. Попробуй ещё раз.";
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
