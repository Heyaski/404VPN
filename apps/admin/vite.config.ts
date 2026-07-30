import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // отдаётся Caddy по пути /admin/
  base: "/admin/",
  server: {
    port: Number(process.env.PORT) || 5174,
    proxy: { "/admin/api": "http://127.0.0.1:8080" },
  },
});
