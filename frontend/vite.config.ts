import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const runtimeTarget = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.IOT_IDS_API_PROXY_TARGET;
  const apiTarget = runtimeTarget || loadEnv(mode, ".", "").IOT_IDS_API_PROXY_TARGET || "http://localhost:8000";
  const proxy = { "/api": { target: apiTarget, changeOrigin: true, ws: true } };
  return ({
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
    proxy,
  },
  server: {
    port: 5173,
    proxy,
  },
  });
});
