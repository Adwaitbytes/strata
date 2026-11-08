import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const PAGES = ["/arena", "/agents/1", `/markets/0x${"0".repeat(63)}1`, "/join", "/docs", "/docs/scoring", "/transparency", "/status", "/terms", "/risk"];

for (const theme of ["dark", "light"] as const) {
  test.describe(`axe (${theme})`, () => {
    for (const path of PAGES) {
      test(`${path} has no serious or critical violations`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("strata-theme", t), theme);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        // Let data load so the real content is audited, not only skeletons.
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
        const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
      });
    }
  });
}
