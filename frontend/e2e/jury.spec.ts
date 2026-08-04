import { expect, test, type APIRequestContext } from "@playwright/test";

interface ReplayStatus {
  status: string;
  processed: number;
  total: number;
  error: string | null;
}

async function waitForReplay(
  request: APIRequestContext,
  expected: string,
): Promise<ReplayStatus> {
  return expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:8001/api/v1/replay/status");
    expect(response.ok()).toBeTruthy();
    return (await response.json() as ReplayStatus).status;
  }, { timeout: 30_000 }).toBe(expected).then(async () => {
    const response = await request.get("http://127.0.0.1:8001/api/v1/replay/status");
    return await response.json() as ReplayStatus;
  });
}

test.describe.serial("jury path with promoted models", () => {
  test("fresh connected UI has no fixture alerts", async ({ page, request }) => {
    const health = await request.get("http://127.0.0.1:8001/health");
    expect(health.ok()).toBeTruthy();
    expect((await health.json()).fallback).toBeFalsy();
    expect(await (await request.get("http://127.0.0.1:8001/alerts")).json()).toEqual([]);

    await page.goto("/");
    await expect(page.getByText("System connected")).toBeVisible();
    await expect(page.getByText("Fixture data", { exact: true })).toHaveCount(0);
  });

  test("normal replay persists predictions without alerts", async ({ request }) => {
    const response = await request.post("http://127.0.0.1:8001/api/v1/replay/start", {
      data: { mode: "dataset", scenario: "normal", limit: 8, interval_ms: 0, speed: 100 },
    });
    expect(response.status()).toBe(202);
    const status = await waitForReplay(request, "completed");
    expect(status.processed).toBe(8);
    expect(await (await request.get("http://127.0.0.1:8001/alerts")).json()).toEqual([]);
  });

  test("attack replay completes and exposes both model versions", async ({ page, request }) => {
    const response = await request.post("http://127.0.0.1:8001/api/v1/replay/start", {
      data: { mode: "dataset", scenario: "attack", limit: 8, interval_ms: 0, speed: 100 },
    });
    expect(response.status()).toBe(202);
    await waitForReplay(request, "completed");
    const alerts = await (await request.get("http://127.0.0.1:8001/alerts")).json();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].detector_model_version).toBeTruthy();
    expect(alerts[0].classifier_model_version).toBeTruthy();

    await page.goto("/?view=alerts");
    const row = page.getByRole("table", { name: "Security alerts" }).getByRole("row").first();
    await expect(row).toBeVisible();
    await row.click();
    const explanationStages = page.getByRole("dialog").locator(".explanation-stage");
    await expect(explanationStages).toHaveCount(2, { timeout: 15_000 });
    await expect(explanationStages.nth(0)).toContainText("Detector");
    await expect(explanationStages.nth(1)).toContainText("Classifier");
    await expect(page.getByText("On-demand explanation is unavailable.")).toHaveCount(0);
  });

  test("pause, resume, and stop are valid lifecycle transitions", async ({ request }) => {
    expect((await request.post("http://127.0.0.1:8001/api/v1/replay/start", {
      data: { mode: "dataset", scenario: "attack", limit: 100, interval_ms: 100, speed: 1 },
    })).status()).toBe(202);
    expect((await request.post("http://127.0.0.1:8001/api/v1/replay/pause")).ok()).toBeTruthy();
    await waitForReplay(request, "paused");
    expect((await request.post("http://127.0.0.1:8001/api/v1/replay/resume", {
      data: { speed: 4 },
    })).ok()).toBeTruthy();
    await waitForReplay(request, "running");
    expect((await request.post("http://127.0.0.1:8001/api/v1/replay/stop")).ok()).toBeTruthy();
    await waitForReplay(request, "stopped");
  });

  test("analyst feedback remains after reload", async ({ page }) => {
    await page.goto("/?view=alerts");
    await page.getByRole("table", { name: "Security alerts" }).getByRole("row").first().click();
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Saved as resolved.", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("table", { name: "Security alerts" }).getByRole("row").first().click();
    await expect(page.getByText("resolved", { exact: true }).first()).toBeVisible();
  });

  test("core dashboard stays within desktop, projector, tablet, and mobile viewports", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(page.locator("#main-content")).toBeVisible();
      expect(await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )).toBeTruthy();
    }
  });
});
