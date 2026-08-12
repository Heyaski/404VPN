import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function tokenPath(): string {
  return path.join(app.getPath("userData"), "device-token.bin");
}

export function loadToken(): string | null {
  try {
    const file = tokenPath();
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  const file = tokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(token));
  } else {
    fs.writeFileSync(file, token, "utf8");
  }
}

export function clearToken(): void {
  try {
    fs.unlinkSync(tokenPath());
  } catch {
    /* ignore */
  }
}
