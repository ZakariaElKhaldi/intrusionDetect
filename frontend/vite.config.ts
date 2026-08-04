import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/zrender")) return "zrender";
          if (id.includes("node_modules/echarts")) return "echarts";
          if (id.includes("cytoscape-fcose") || id.includes("cose-base") || id.includes("layout-base")) return "topology-layout";
          if (id.includes("node_modules/cytoscape")) return "cytoscape";
        },
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
