import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tunnelDir = path.join(root, "tunnel");
const outDir = path.join(tunnelDir, "dist");
fs.mkdirSync(outDir, { recursive: true });

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    encoding: "utf8",
  });
  return r.status === 0;
}

if (!which("go")) {
  console.error(
    "Go не найден в PATH. Установи Go 1.22+ и повтори: https://go.dev/dl/",
  );
  process.exit(1);
}

{
  const tidy = spawnSync("go", ["mod", "tidy"], {
    cwd: tunnelDir,
    stdio: "inherit",
  });
  if (tidy.status !== 0) process.exit(tidy.status ?? 1);
}

const targets = [];
if (process.argv.includes("--all")) {
  targets.push(
    { goos: "windows", goarch: "amd64", out: "tunnel-helper.exe" },
    { goos: "darwin", goarch: "amd64", out: "tunnel-helper-darwin-amd64" },
    { goos: "darwin", goarch: "arm64", out: "tunnel-helper-darwin-arm64" },
  );
} else {
  const goos = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const goarch = process.arch === "arm64" ? "arm64" : "amd64";
  const out = goos === "windows" ? "tunnel-helper.exe" : "tunnel-helper";
  targets.push({ goos, goarch, out });
}

for (const t of targets) {
  const outPath = path.join(outDir, t.out);
  console.log(`Building helper ${t.goos}/${t.goarch} → ${outPath}`);
  const r = spawnSync(
    "go",
    ["build", "-o", outPath, "."],
    {
      cwd: tunnelDir,
      stdio: "inherit",
      env: {
        ...process.env,
        GOOS: t.goos,
        GOARCH: t.goarch,
        CGO_ENABLED: "0",
      },
    },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// На macOS для universal/текущей arch копируем каноничное имя.
if (process.platform === "darwin") {
  const archOut =
    process.arch === "arm64"
      ? path.join(outDir, "tunnel-helper-darwin-arm64")
      : path.join(outDir, "tunnel-helper-darwin-amd64");
  const canonical = path.join(outDir, "tunnel-helper");
  if (fs.existsSync(archOut) && !fs.existsSync(canonical)) {
    fs.copyFileSync(archOut, canonical);
  }
}

console.log("Tunnel helper built → tunnel/dist/");
