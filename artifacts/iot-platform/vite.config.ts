import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Both are overridable by the environment (a reverse proxy may want the app on a
// sub-path), and both default so the dev server starts with no configuration.
const port = Number(process.env.PORT ?? "5173");
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Proxy /api to the API server so the SPA and the API appear on one origin
    // during development — relative `fetch("/api/…")` calls work with no CORS,
    // and `ws: true` carries the /api/ws WebSocket upgrade through as well.
    //
    // In production a reverse proxy does this job instead: it serves the built
    // SPA from dist/public and forwards /api to the API server. See
    // docs/operations/vm-deployment-checklist.md.
    //
    // The 8080 target matches the default in artifacts/api-server/src/index.ts —
    // change one and you must change the other.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
