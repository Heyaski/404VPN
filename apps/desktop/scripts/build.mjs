import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(root, "src/main/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(root, "dist/main/index.js"),
  external: ["electron"],
  packages: "bundle",
  banner: {
    // electron ESM + __dirname helpers
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
});

await esbuild.build({
  entryPoints: [path.join(root, "src/preload/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  // .cjs — иначе при "type": "module" Electron пытается require() ESM и UI пустой
  outfile: path.join(root, "dist/preload/index.cjs"),
  external: ["electron"],
});

await viteBuild({
  configFile: path.join(root, "vite.config.ts"),
});

console.log("Desktop app built → dist/");
