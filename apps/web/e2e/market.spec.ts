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
