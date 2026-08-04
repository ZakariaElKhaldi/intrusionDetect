import { defineConfig } from "@playwright/test";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  testDir: ".",
  testMatch: "e2e.spec.ts",
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
      env: { IOT_IDS_INSTANCE_ID: "project-e2e-production-preview" },
      url: "http://127.0.0.1:8001/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort",
      cwd: path.join(repository, "frontend"),
      env: {
        IOT_IDS_API_PROXY_TARGET: "http://127.0.0.1:8001",
      },
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
