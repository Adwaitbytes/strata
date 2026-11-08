import { expect, test } from "./fixtures";

test.describe("Agent page", () => {
  test("shows identity, metrics, quotes, history, guards and tuner feed", async ({ page }) => {
    await page.goto("/agents/1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("data-labels").first()).toContainText("TESTNET");
    const focal = page.getByTestId("agent-focal");
    await expect(focal).toContainText(/Score, epoch #\d+/);
    await expect(focal).toContainText(/#\d/);
    await expect(page.locator("#identity").getByText("ERC-8004 identity")).toBeVisible();
    await expect(page.getByRole("table", { name: "Live quotes by level" })).toBeVisible();
    await expect(page.getByRole("group", { name: /Score history over/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Guard events" })).toBeVisible();
    await expect(page.getByText("SHADOW").first()).toBeVisible();
  });

  test("verifies the score in the browser", async ({ page }) => {
    await page.goto("/agents/1");
    await page.getByRole("button", { name: "Verify my score" }).click();
    await expect(page.getByTestId("verify-local")).toContainText("Passed");
    // MOCK scores are never checked against the real contract.
    await expect(page.getByTestId("verify-onchain")).toContainText("Not available");
    await expect(page.getByTestId("verify-onchain")).toContainText("never posted onchain");
  });

  test("handles an unknown agent", async ({ page }) => {
    await page.goto("/agents/999");
    await expect(page.getByRole("alert").filter({ hasText: "Not found" })).toBeVisible();
  });

  test("rejects a malformed id with a 404", async ({ page }) => {
    const res = await page.goto("/agents/abc");
    expect(res?.status()).toBe(404);
  });
});
