import { spawn } from "node:child_process";
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const mainCtx = await esbuild.context({
  entryPoints: [path.join(root, "src/main/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(root, "dist/main/index.js"),
  external: ["electron"],
  packages: "bundle",
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
});

const preloadCtx = await esbuild.context({
  entryPoints: [path.join(root, "src/preload/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(root, "dist/preload/index.cjs"),
  external: ["electron"],
});

await mainCtx.rebuild();
await preloadCtx.rebuild();
await mainCtx.watch();
await preloadCtx.watch();

const vite = await createServer({
  configFile: path.join(root, "vite.config.ts"),
});
await vite.listen();

const electronBin = path.join(
  root,
  "node_modules",
  "electron",
  "cli.js",
);

const child = spawn(process.execPath, [electronBin, "."], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
});

child.on("exit", async (code) => {
  await vite.close();
  await mainCtx.dispose();
  await preloadCtx.dispose();
  process.exit(code ?? 0);
});
