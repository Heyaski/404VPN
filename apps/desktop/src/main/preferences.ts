import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface Preferences {
  dnsFilter: boolean;
  autoConnect: boolean;
}

const DEFAULTS: Preferences = {
  dnsFilter: false,
  autoConnect: false,
};

function prefsPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

export function loadPreferences(): Preferences {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), "utf8")) as Partial<Preferences>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePreferences(prefs: Preferences): void {
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), "utf8");
}
