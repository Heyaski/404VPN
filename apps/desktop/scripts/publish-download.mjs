/**
 * Копирует свежие артефакты electron-builder в releases/desktop/public
 * под стабильными именами для раздачи через Caddy /download.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = path.join(root, "releases", "desktop");
const publicDir = path.join(outDir, "public");
fs.mkdirSync(publicDir, { recursive: true });

const pageSrc = path.join(root, "apps", "desktop", "download", "index.html");
fs.copyFileSync(pageSrc, path.join(publicDir, "index.html"));

const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
const setup = files.find((f) => /^404VPN-Setup-.*\.exe$/i.test(f));
const dmg =
  files.find((f) => /^404VPN-.*-arm64\.dmg$/i.test(f)) ||
  files.find((f) => /^404VPN-.*\.dmg$/i.test(f));

if (setup) {
  fs.copyFileSync(path.join(outDir, setup), path.join(publicDir, "404VPN-Setup.exe"));
  console.log("Published", setup, "→ public/404VPN-Setup.exe");
} else {
  console.warn("No Windows setup exe found in releases/desktop");
}

if (dmg) {
  fs.copyFileSync(path.join(outDir, dmg), path.join(publicDir, "404VPN.dmg"));
  console.log("Published", dmg, "→ public/404VPN.dmg");
} else {
  console.warn("No macOS dmg found in releases/desktop");
}

const apkCandidates = [
  path.join(root, "vpn_android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
  path.join(root, "vpn_android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  path.join(publicDir, "404VPN.apk"),
];
const apk = apkCandidates.find((p) => fs.existsSync(p));
if (apk && path.resolve(apk) !== path.resolve(publicDir, "404VPN.apk")) {
  fs.copyFileSync(apk, path.join(publicDir, "404VPN.apk"));
  console.log("Published", apk, "→ public/404VPN.apk");
} else if (apk) {
  console.log("Android APK already in public/404VPN.apk");
} else {
  console.warn("No Android APK found");
}
