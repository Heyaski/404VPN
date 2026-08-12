/**
 * Диагностика: расшифровать токен, запросить /api/device/tunnel, дернуть helper up.
 * Запуск: npx electron scripts/diag-tunnel.mjs
 */
import { app, safeStorage } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "../../releases/desktop-v4/win-unpacked/resources/tunnel/tunnel-helper.exe");
const apiBase = "https://404studiotech-miniapp.ru";

await app.whenReady();

const tokenFile = path.join(app.getPath("userData"), "device-token.bin");
if (!fs.existsSync(tokenFile)) {
  console.error("no token");
  app.exit(1);
}
const token = safeStorage.isEncryptionAvailable()
  ? safeStorage.decryptString(fs.readFileSync(tokenFile))
  : fs.readFileSync(tokenFile, "utf8");

console.log("token ok, len", token.length);

const tunnelRes = await fetch(`${apiBase}/api/device/tunnel`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
});
const tunnelText = await tunnelRes.text();
console.log("tunnel HTTP", tunnelRes.status);
if (!tunnelRes.ok) {
  console.error(tunnelText);
  app.exit(2);
}
const cfg = JSON.parse(tunnelText);
console.log("endpoint", cfg.peer?.endpoint, "address", cfg.address);

if (!fs.existsSync(helper)) {
  console.error("helper missing", helper);
  app.exit(3);
}

const child = spawn(helper, [], {
  cwd: path.dirname(helper),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => console.error("STDERR", d.toString()));

const payload = {
  privateKey: cfg.privateKey,
  address: cfg.address,
  dns: cfg.dns ?? [],
  peer: {
    publicKey: cfg.peer.publicKey,
    ...(cfg.peer.presharedKey ? { presharedKey: cfg.peer.presharedKey } : {}),
    endpoint: cfg.peer.endpoint,
    allowedIps: cfg.peer.allowedIps ?? ["0.0.0.0/0", "::/0"],
    ...(cfg.peer.persistentKeepalive != null
      ? { persistentKeepalive: cfg.peer.persistentKeepalive }
      : {}),
  },
};

const line = JSON.stringify({ id: 1, cmd: "up", payload }) + "\n";
console.log("sending up…");
child.stdin.write(line);

const timer = setTimeout(() => {
  console.error("timeout");
  child.kill();
  app.exit(4);
}, 20000);

child.stdout.on("data", (chunk) => {
  console.log("STDOUT", chunk.toString());
  clearTimeout(timer);
  child.stdin.write(JSON.stringify({ id: 2, cmd: "down" }) + "\n");
  setTimeout(() => {
    child.kill();
    app.exit(0);
  }, 1500);
});

child.on("exit", (code) => {
  console.log("helper exit", code);
});
