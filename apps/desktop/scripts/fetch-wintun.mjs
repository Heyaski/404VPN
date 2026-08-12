/**
 * Достаёт wintun.dll в tunnel/dist/.
 * wintun.net из РФ/части сетей часто недоступен — пробуем несколько зеркал,
 * затем официальный установщик WireGuard (внутри есть wintun.dll).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "tunnel", "dist");
const dllOut = path.join(outDir, "wintun.dll");

fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(dllOut) && fs.statSync(dllOut).size > 50_000) {
  console.log("wintun.dll already present");
  process.exit(0);
}

function curl(url, dest, maxTime = 60) {
  console.log("GET", url);
  execFileSync(
    "curl",
    ["-L", "--fail", "--retry", "1", "--max-time", String(maxTime), "-o", dest, url],
    { stdio: "inherit" },
  );
}

function findDll(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const found = findDll(p);
      if (found) return found;
    } else if (name.toLowerCase() === "wintun.dll") {
      // предпочитаем amd64
      if (p.toLowerCase().includes("amd64") || p.toLowerCase().includes("x86_64")) return p;
      return p;
    }
  }
  return null;
}

function extractZip(zipPath, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", dest], { stdio: "inherit" });
  }
}

function tryFromZipUrl(url) {
  const zipPath = path.join(outDir, "wintun-download.zip");
  try {
    curl(url, zipPath, 45);
  } catch {
    return false;
  }
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 50_000) {
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    return false;
  }
  const extractDir = path.join(outDir, "wintun-extract");
  try {
    extractZip(zipPath, extractDir);
    const dll = findDll(extractDir);
    if (!dll) return false;
    fs.copyFileSync(dll, dllOut);
    return fs.statSync(dllOut).size > 50_000;
  } finally {
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

/** WireGuard installer — MSI/EXE, часто доступнее wintun.net */
function tryFromWireGuardInstaller() {
  if (process.platform !== "win32") return false;
  const urls = [
    "https://download.wireguard.com/windows-client/wireguard-installer.exe",
  ];
  const installer = path.join(outDir, "wireguard-installer.exe");
  const extractDir = path.join(outDir, "wg-extract");
  for (const url of urls) {
    try {
      curl(url, installer, 120);
    } catch {
      continue;
    }
    if (!fs.existsSync(installer) || fs.statSync(installer).size < 100_000) continue;

    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    // NSIS / Inno иногда распаковываются 7z; пробуем Expand-Archive и dark/lessmsi нет —
    // простой путь: скопировать из установленного WireGuard, если есть.
    const candidates = [
      "C:\\Program Files\\WireGuard\\wintun.dll",
      "C:\\Program Files\\WireGuard\\amd64\\wintun.dll",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        fs.copyFileSync(c, dllOut);
        try { fs.unlinkSync(installer); } catch { /* ignore */ }
        return true;
      }
    }

    // Тихая распаковка через 7z, если есть
    try {
      execFileSync("7z", ["x", `-o${extractDir}`, installer, "-y"], { stdio: "inherit" });
      const dll = findDll(extractDir);
      if (dll) {
        fs.copyFileSync(dll, dllOut);
        try { fs.unlinkSync(installer); } catch { /* ignore */ }
        fs.rmSync(extractDir, { recursive: true, force: true });
        return fs.statSync(dllOut).size > 50_000;
      }
    } catch {
      /* 7z нет */
    }
  }
  try { fs.unlinkSync(installer); } catch { /* ignore */ }
  fs.rmSync(extractDir, { recursive: true, force: true });
  return false;
}

const zipMirrors = [
  "https://www.wintun.net/builds/wintun-0.14.1.zip",
  // jsDelivr / ghproxy иногда держат копии в чужих репо с вендором — пробуем wireguard-go deps нет
];

let ok = false;
for (const url of zipMirrors) {
  if (tryFromZipUrl(url)) {
    ok = true;
    break;
  }
}

if (!ok) {
  ok = tryFromWireGuardInstaller();
}

if (ok) {
  console.log("wintun.dll →", dllOut, `(${fs.statSync(dllOut).size} bytes)`);
  process.exit(0);
}

console.warn(`
Не удалось скачать wintun.dll автоматически (сайт wintun.net часто блокируется).

Варианты:
1) Установи WireGuard for Windows с https://www.wireguard.com/install/
   и скопируй "C:\\Program Files\\WireGuard\\wintun.dll"
   → ${dllOut}

2) Скачай zip с другой сети/VPN: https://www.wintun.net/builds/wintun-0.14.1.zip
   файл bin/amd64/wintun.dll → ${dllOut}

Потом: npm run dist:win
`);
process.exit(0);
