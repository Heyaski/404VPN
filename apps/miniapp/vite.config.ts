import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    // в дев-режиме API берём с локально запущенного core (docker compose)
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
});
