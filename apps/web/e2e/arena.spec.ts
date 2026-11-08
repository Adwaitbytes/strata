import { expect, test } from "./fixtures";

test.describe("Arena", () => {
  test("shows the leaderboard with network and provenance labels", async ({ page }) => {
    await page.goto("/arena");
    await expect(page.getByRole("heading", { level: 1, name: "Arena" })).toBeVisible();
    await expect(page.getByTestId("mock-notice")).toBeVisible();
    const labels = page.getByTestId("data-labels").first();
    await expect(labels).toContainText("TESTNET");
    await expect(labels).toContainText("MOCK");
    await expect(page.getByTestId("leaderboard-row")).toHaveCount(6);
    await expect(page.getByText(/Season 0 ends in/)).toBeVisible();
  });

  test("explains every column on hover", async ({ page }) => {
    await page.goto("/arena");
    await page.getByRole("columnheader").getByRole("button", { name: /Score: what this means/ }).hover();
    await expect(page.getByRole("tooltip")).toContainText("0 to 10,000");
    await expect(page.getByRole("tooltip")).toContainText("Source:");
  });

  test("switches to mainnet and shows a designed empty state", async ({ page }) => {
    await page.goto("/arena");
    await page.getByRole("radio", { name: "Mainnet" }).click();
    await expect(page).toHaveURL(/network=mainnet/);
    await expect(page.getByText("No agents scored on mainnet yet")).toBeVisible();
    await expect(page.getByTestId("data-labels").first()).toContainText("MAINNET");
  });

  test("filters by market and links through to a market page", async ({ page }) => {
    await page.goto("/arena");
    await expect(page.getByTestId("market-card")).toHaveCount(3);
    await page.getByLabel("Market").selectOption({ index: 1 });
    await expect(page.getByTestId("leaderboard-row")).toHaveCount(2);
    await page.getByTestId("market-card").first().click();
    await expect(page).toHaveURL(/\/markets\/0x0{63}1$/);
  });

  test("navigates to an agent page", async ({ page }) => {
    await page.goto("/arena");
    await page.getByTestId("leaderboard-row").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/agents\/\d+$/);
  });

  test("becomes cards on mobile @mobile", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/arena");
    await expect(page.getByTestId("leaderboard-card")).toHaveCount(6);
    await expect(page.getByTestId("leaderboard-row").first()).toBeHidden();
  });
});
