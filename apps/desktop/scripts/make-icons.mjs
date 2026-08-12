import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const srcCandidates = [
  path.join(buildDir, "icon-source.png"),
  path.join(buildDir, "icon.png"),
  path.join(
    process.env.USERPROFILE ?? "",
    ".cursor",
    "projects",
    "d-project-404VPN",
    "assets",
    "404vpn-icon-1024.png",
  ),
];

fs.mkdirSync(buildDir, { recursive: true });

const src = srcCandidates.find((p) => p && fs.existsSync(p));
if (!src) {
  console.error("icon source PNG not found");
  process.exit(1);
}

const pngOut = path.join(buildDir, "icon.png");
if (path.resolve(src) !== path.resolve(pngOut)) {
  fs.copyFileSync(src, pngOut);
}
console.log("icon.png ←", src);

const ico = await pngToIco(pngOut);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
console.log("icon.ico ready");
