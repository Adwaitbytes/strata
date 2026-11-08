import { SIGNING_METHODS, TEST_ADDRESS, expect, installFakeWallet, test, walletCalls } from "./fixtures";

test.describe("Join wizard", () => {
  test("without a wallet, explains what to install", async ({ page }) => {
    await page.goto("/join");
    await expect(page.getByText("Not available to US persons or sanctioned jurisdictions.").first()).toBeVisible();
    await expect(page.getByText("No browser wallet found")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  test("never asks for a signature on page load", async ({ page }) => {
    await installFakeWallet(page, { chainId: 1439 });
    await page.goto("/join");
    await expect(page.getByRole("button", { name: /Connect/ })).toBeVisible();
    await page.waitForTimeout(500);
    const calls = await walletCalls(page);
    expect(calls.filter((c) => SIGNING_METHODS.includes(c))).toEqual([]);
    expect(calls).not.toContain("eth_requestAccounts");
  });

  test("mainnet stays behind an explicit acknowledgement", async ({ page }) => {
    await installFakeWallet(page, { chainId: 1439 });
    await page.goto("/join");
    await page.getByRole("radio", { name: /Mainnet/ }).check();
    await expect(page.getByRole("button", { name: /Connect browser wallet/ })).toBeDisabled();
    await page.getByTestId("mainnet-ack").check();
    await expect(page.getByRole("button", { name: /Connect browser wallet/ })).toBeEnabled();
  });

  test("walks all four steps to a readable preview and starter kit", async ({ page }) => {
    await installFakeWallet(page, { chainId: 1 });
    await page.goto("/join");

    // Step 1: connect, then switch from chain 1 to testnet 1439.
    await page.getByRole("button", { name: /Connect browser wallet/ }).click();
    await expect(page.getByTestId("connected-address")).toContainText(TEST_ADDRESS.slice(0, 6));
    const switchBtn = page.getByRole("button", { name: "Switch to chain 1439" });
    if (await switchBtn.isVisible()) await switchBtn.click();
    await expect(page.getByText(/On Injective EVM Testnet \(chain 1439\)/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 2: link an identity.
    await expect(page.getByRole("heading", { name: /Identity/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create identity" })).toBeDisabled();
    await page.getByLabel("Identity token ID").fill("abc");
    await expect(page.getByText("Enter the numeric token ID")).toBeVisible();
    await page.getByLabel("Identity token ID").fill("42");
    await page.getByRole("button", { name: "Continue" }).click();

    // Step 3: name, markets, rules, disclosures.
    await expect(page.getByRole("heading", { name: /Markets and rules/ })).toBeVisible();
    const review = page.getByRole("button", { name: "Review enrollment" });
    await page.getByLabel("Agent name").fill("e2e-agent");
    await page.getByRole("checkbox").first().check();
    await expect(review).toBeDisabled();
    await page.getByTestId("risk-ack").check();
    await expect(review).toBeDisabled();
    await page.getByTestId("geo-ack").check();
    await review.click();

    // Step 4: human-readable preview, enroll disabled while the arena is not deployed.
    const preview = page.getByTestId("tx-preview");
    await expect(preview).toContainText("StrataArena.enroll");
    await expect(preview).toContainText("#42");
    await expect(preview).toContainText("0 INJ");
    await expect(preview).toContainText(`${TEST_ADDRESS}000000000000000000000000`);
    await expect(page.getByRole("button", { name: "Sign and enroll" })).toBeDisabled();

    const download = page.waitForEvent("download");
    await page.getByTestId("download-kit").click();
    expect((await download).suggestedFilename()).toBe("strata-agent-e2e-agent.json");

    const calls = await walletCalls(page);
    expect(calls.filter((c) => SIGNING_METHODS.includes(c))).toEqual([]);
  });
});
