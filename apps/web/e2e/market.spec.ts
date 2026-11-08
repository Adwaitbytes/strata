import { expect, test } from "./fixtures";

const MARKET = `/markets/0x${"0".repeat(63)}1`;

test.describe("Market page", () => {
  test("shows depth ladder, spread chart with baseline, share and session", async ({ page }) => {
    await page.goto(MARKET);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("PERP");
    await expect(page.getByRole("table", { name: /Order book/ })).toBeVisible();
    await expect(page.getByText("BASELINE").first()).toBeVisible();
    await expect(page.locator("#spread canvas").first()).toBeVisible();
    await expect(page.locator("#spread figcaption")).toContainText("Baseline average");
    await expect(page.getByRole("heading", { name: /Session state/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /STRATA provides/ })).toBeVisible();
  });

  test("labels samples without STRATA depth by provenance, never as With STRATA", async ({ page }) => {
    await page.goto(MARKET);
    await expect(page.getByTestId("legend-strata")).toHaveText("With STRATA");
    await expect(page.getByTestId("legend-no-strata")).toHaveText("Mock, no STRATA quotes");
    await page.getByText("Show data table").click();
    const labels = page.locator("#spread table tbody tr td:nth-child(3)");
    await expect(labels.filter({ hasText: "Mock, no STRATA quotes" })).toHaveCount(8);
    await expect(labels.filter({ hasText: "Before STRATA" })).toHaveCount(40);
  });

  test("offers the chart data as a table", async ({ page }) => {
    await page.goto(MARKET);
    await page.getByText("Show data table").click();
    await expect(page.locator("#spread table tbody tr").first()).toBeVisible();
  });

  test("404s on a malformed market id", async ({ page }) => {
    const res = await page.goto("/markets/not-a-market");
    expect(res?.status()).toBe(404);
  });
});
