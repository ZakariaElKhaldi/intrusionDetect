import { defineConfig } from "@playwright/test";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: ".",
  testMatch: "jury.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  outputDir: "../test-results",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: "/usr/bin/google-chrome-stable" },
  },
  webServer: [
    {
      command: "./scripts/start_e2e_backend.sh",
      cwd: repository,
      url: "http://127.0.0.1:8001/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4174 --strictPort",
      cwd: path.join(repository, "frontend"),
      env: {
        VITE_API_URL: "http://127.0.0.1:8001",
        VITE_WS_URL: "ws://127.0.0.1:8001/api/v1/live",
      },
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
