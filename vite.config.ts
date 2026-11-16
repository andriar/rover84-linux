import { defineConfig } from "vite";

export default defineConfig({
  server: { proxy: { "/api": "http://127.0.0.1:5174" } },
  build: { rollupOptions: { input: { index: "index.html", via: "via.html", rgb: "rgb.html", mouse: "mouse.html" } } },
});
