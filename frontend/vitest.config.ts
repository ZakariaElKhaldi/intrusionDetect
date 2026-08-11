import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const systemChrome = "/usr/bin/google-chrome-stable";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: "./src/test/setup.ts",
        },
      },
      {
        // Pre-bundle React before the browser starts. A mid-run Vite optimization
        // reload can otherwise leave stories and the renderer on different React
        // module instances, producing invalid hook calls on a cold CI cache.
        optimizeDeps: {
          include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        },
        resolve: {
          dedupe: ["react", "react-dom"],
        },
        plugins: [
          storybookTest({
            configDir: path.join(dirname, ".storybook"),
            storybookScript: "npm run storybook -- --no-open",
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            provider: playwright({
              launchOptions: existsSync(systemChrome) ? { executablePath: systemChrome } : {},
            }),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
