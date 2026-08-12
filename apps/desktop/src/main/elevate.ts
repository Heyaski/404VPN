import { app } from "electron";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Надёжная проверка admin через SID группы Administrators. */
export function isElevated(): boolean {
  if (process.platform !== "win32") return true;
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    return out.trim().toLowerCase() === "true";
  } catch {
    try {
      execFileSync("net", ["session"], { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
}

/** Запросить UAC и открыть новую копию. Старое окно НЕ закрываем сами из connect. */
export function relaunchElevated(): boolean {
  if (process.platform !== "win32") return false;

  const exe = process.execPath;
  const launchArgs = app.isPackaged ? [] : process.argv.slice(1).filter((a) => !a.startsWith("--"));

  const elevate = app.isPackaged
    ? path.join(process.resourcesPath, "elevate.exe")
    : "";

  try {
    if (elevate && fs.existsSync(elevate)) {
      spawn(elevate, [exe, ...launchArgs], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return true;
    }
  } catch {
    /* fallback */
  }

  const psArgs = launchArgs.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
  const cmd = launchArgs.length
    ? `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList @(${psArgs}) -Verb RunAs`
    : `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -Verb RunAs`;

  spawn("powershell", ["-NoProfile", "-Command", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  return true;
}
