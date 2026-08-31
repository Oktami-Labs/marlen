import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const apiTarget = mode === "tauri-preview" ? "http://127.0.0.1:3001" : "http://localhost:3001";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          // http-proxy leaves the browser-side response open when the backend
          // closes mid-stream, which turns open SSE connections (/api/events)
          // into silent zombies across a server restart. Destroying the
          // response lets EventSource see the drop and reconnect.
          configure(proxy) {
            proxy.on("proxyRes", (proxyRes, _req, res) => {
              proxyRes.on("close", () => {
                if (!res.writableEnded) res.destroy();
              });
            });
          },
        },
      },
    },
  };
});
