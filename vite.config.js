import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// El código fuente del frontend vive en client/. El build se escribe en public/,
// que es lo que server.js sirve como estático (express.static).
// En desarrollo, Vite corre en :5173 y hace proxy de /api al backend en :3000.
export default defineConfig({
  root: "client",
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000"
    }
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
    sourcemap: true
  }
});
