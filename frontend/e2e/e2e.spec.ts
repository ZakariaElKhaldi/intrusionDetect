import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

interface ReplayStatus {
  status: string;
  processed: number;
  total: number;
  error: string | null;
}

const pages = [
  ["overview", "Live overview"],
  ["alerts", "Alert investigation"],
  ["topology", "Network topology"],
  ["models", "Model analysis"],
  ["testing", "Observation lab"],
] as const;

async function apiJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`);
  expect(response.ok(), `${path} returned ${response.status()}`).toBeTruthy();
  return await response.json() as T;
}

async function waitForReplay(
  request: APIRequestContext,
  expected: string,
): Promise<ReplayStatus> {
  await expect.poll(async () => (
    await apiJson<ReplayStatus>(request, "/replay/status")
  ).status, { timeout: 30_000 }).toBe(expected);
  return apiJson<ReplayStatus>(request, "/replay/status");
}

async function waitForConnectedPage(page: Page, view = "overview") {
  await page.goto(`/?view=${view}`);
  await expect(page.getByText("Live stream connected", { exact: true })).toBeVisible();
  await expect(page.locator(".system-status small")).toContainText("stream live", {
    timeout: 10_000,
  });
}

async function startReplayFromBrowser(
  page: Page,
  scenario: string,
  limit: number,
  speed = "4",
) {
  await page.getByLabel("Replay scenario").selectOption(scenario);
  await page.getByLabel("Replay speed").selectOption(speed);
  await page.getByLabel("Replay limit").fill(String(limit));
  await page.getByRole("button", { name: "Start replay" }).click();
}

async function attachViewport(page: Page, name: string) {
  const image = await page.screenshot({
    animations: "disabled",
    fullPage: false,
    caret: "hide",
  });
  expect(image.byteLength).toBeGreaterThan(1_000);
  await test.info().attach(name, { body: image, contentType: "image/png" });
}

function runtimeIssues(page: Page) {
  const issues: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      if (location.url.endsWith("/favicon.ico")) return;
      issues.push(`console: ${message.text()} ${location.url || "unknown source"}`);
    }
  });
  page.on("requestfailed", (request) => {
    issues.push(`request: ${request.method()} ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      issues.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  return issues;
}

test.describe.serial("production-preview end-to-end path", () => {
  test("owns the expected backend instance and starts with honest empty data", async ({ page, request }) => {
    const issues = runtimeIssues(page);
    const health = await apiJson<Record<string, unknown>>(request, "/health");
    expect(health.instance_id).toBe("project-e2e-production-preview");
    expect(health.fallback).toBeFalsy();
    expect(health.production_bundle_valid).toBe(true);
    expect(await apiJson<unknown[]>(request, "/alerts")).toEqual([]);

    await waitForConnectedPage(page);
    await expect(page.getByText("Fixture data", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No unresolved alerts in the current dataset.")).toBeVisible();
    await attachViewport(page, "01-empty-overview.png");
    expect(issues).toEqual([]);
  });

  test("normal replay is controlled in the browser and streams predictions without alerts", async ({ page, request }) => {
    const issues = runtimeIssues(page);
    await waitForConnectedPage(page);
    await startReplayFromBrowser(page, "normal", 8);
    await expect(page.locator('[data-replay-status="completed"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator("article.metric").filter({ hasText: "Persisted predictions" }).locator("strong"),
    ).toHaveText("8");
    expect((await waitForReplay(request, "completed")).processed).toBe(8);
    expect(await apiJson<unknown[]>(request, "/alerts")).toEqual([]);
    expect(issues).toEqual([]);
  });

  test("attack replay streams alerts into the UI without reload", async ({ page, request }) => {
    const issues = runtimeIssues(page);
    await waitForConnectedPage(page);
    await startReplayFromBrowser(page, "attack", 8);
    await expect(page.locator('[data-replay-status="completed"]')).toBeVisible({
      timeout: 20_000,
    });
    const newAlerts = page.getByLabel(/new alerts/);
    await expect(newAlerts).toBeVisible();
    await page.getByRole("button", { name: "Triage alerts", exact: true }).click();
    const firstAlert = page.getByRole("row", { name: /^Open .* alert / }).first();
    await expect(firstAlert).toBeVisible();
    const alerts = await apiJson<Record<string, unknown>[]>(request, "/alerts");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].detector_model_version).toBeTruthy();
    expect(alerts[0].classifier_model_version).toBeTruthy();
    await attachViewport(page, "02-live-attack-alerts.png");
    expect(issues).toEqual([]);
  });

  test("reload hydrates alerts, SHAP works, feedback persists, and focus is restored", async ({ page }) => {
    await waitForConnectedPage(page, "alerts");
    const row = page.getByRole("row", { name: /^Open .* alert / }).first();
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close alert details" })).toBeFocused();
    const detectorTab = dialog.getByRole("tab", { name: "Detector" });
    const classifierTab = dialog.getByRole("tab", { name: "Classifier" });
    await expect(detectorTab).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(dialog.locator(".explanation-stage")).toBeVisible();
    await classifierTab.click();
    await expect(classifierTab).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".explanation-stage")).toBeVisible();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Saved as resolved.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();

    await page.reload();
    const hydratedRow = page.getByRole("row", { name: /^Open .* alert / }).first();
    await hydratedRow.click();
    await expect(
      page.getByRole("dialog").locator(".summary-grid").getByText("resolved", { exact: true }),
    ).toBeVisible();
  });

  test("pause, resume, and stop use browser controls and preserve progress", async ({ page, request }) => {
    await waitForConnectedPage(page);
    await startReplayFromBrowser(page, "attack", 100, "0.5");
    await expect(page.getByRole("button", { name: "Pause replay" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Pause replay" }).click();
    await expect(page.locator('[data-replay-status="paused"]')).toBeVisible();
    const paused = await apiJson<ReplayStatus>(request, "/replay/status");
    await page.waitForTimeout(800);
    expect((await apiJson<ReplayStatus>(request, "/replay/status")).processed).toBe(
      paused.processed,
    );
    await page.getByRole("button", { name: "Resume replay" }).click();
    await expect(page.locator('[data-replay-status="running"]')).toBeVisible();
    await page.getByRole("button", { name: "Stop replay" }).click();
    await expect(page.locator('[data-replay-status="stopped"]')).toBeVisible();
    expect((await waitForReplay(request, "stopped")).processed).toBeGreaterThanOrEqual(
      paused.processed,
    );
  });

  test("replay request failures are explicit and recoverable", async ({ page }) => {
    await waitForConnectedPage(page);
    await page.route("**/api/v1/replay/start", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Audit-injected replay failure" }),
      });
    });
    await startReplayFromBrowser(page, "attack", 3);
    await expect(page.getByRole("alert")).toContainText("Audit-injected replay failure");
    await expect(page.getByRole("button", { name: "Start replay" })).toBeEnabled();
    await page.unroute("**/api/v1/replay/start");
  });

  test("all pages expose accessible landmarks and no serious axe violations", async ({ page }) => {
    test.setTimeout(120_000);
    for (const [view, title] of pages) {
      await waitForConnectedPage(page, view);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      if (view === "models") {
        await page.getByRole("tab", { name: "Classifier", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Attack-family classifier comparison" }),
        ).toBeVisible();
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter((violation) =>
        violation.impact === "serious" || violation.impact === "critical"
      );
      expect(blocking, `${view}: ${blocking.map((item) => item.id).join(", ")}`).toEqual([]);
      if (["overview", "models", "testing"].includes(view)) {
        await attachViewport(page, `page-${view}.png`);
      }
    }
  });

  test("navigation and alert investigation remain keyboard operable", async ({ page }) => {
    await waitForConnectedPage(page);
    const alertsButton = page.getByRole("button", { name: "Triage alerts", exact: true });
    await alertsButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Alert investigation" })).toBeVisible();
    const row = page.getByRole("row", { name: /^Open .* alert / }).first();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(row).toBeFocused();
  });

  test("desktop, projector, tablet, mobile, and 400%-equivalent reflow do not overflow", async ({ page }) => {
    test.setTimeout(120_000);
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "projector", width: 1280, height: 720 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
      { name: "reflow-400-percent", width: 320, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      await waitForConnectedPage(page);
      const layout = await page.evaluate(() => {
        const clientWidth = document.documentElement.clientWidth;
        const overflowing = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < -1 || rect.right > clientWidth + 1);
          })
          .slice(0, 12)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].map((name) => `.${name}`).join("")}`,
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          });
        return {
          clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflowing,
        };
      });
      expect(
        layout.scrollWidth,
        `${viewport.name}: ${JSON.stringify(layout)}`,
      ).toBeLessThanOrEqual(layout.clientWidth);
      await expect(page.getByRole("button", { name: "Start replay" })).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [view] of pages) {
      await waitForConnectedPage(page, view);
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ), `${view} at mobile width`).toBeTruthy();
    }
    await waitForConnectedPage(page, "alerts");
    const row = page.locator(".alert-card").first();
    await expect(row).toBeVisible();
    const rowFits = await row.evaluate((element) => {
      const rowRect = element.getBoundingClientRect();
      return [...element.children].every((child) => {
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return true;
        return rect.left >= rowRect.left - 1 && rect.right <= rowRect.right + 1;
      });
    });
    expect(rowFits, "mobile alert cells must remain within their row").toBeTruthy();
    await attachViewport(page, "03-mobile-alert-rows.png");
  });
});
