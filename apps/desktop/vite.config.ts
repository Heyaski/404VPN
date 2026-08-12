import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve("src/shared"),
    },
  },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
