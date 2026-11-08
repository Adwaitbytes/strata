import { expect, test } from "./fixtures";

const DOCS = [
  ["/docs", "How STRATA works"],
  ["/docs/scoring", "How STRATA scores market makers"],
  ["/docs/guards", null],
  ["/docs/ai-tuner", null],
  ["/docs/architecture", null],
  ["/docs/run-your-own-agent", "Run your own agent"],
  ["/docs/api", "API and MCP reference"],
  ["/docs/contracts", "Contracts"],
] as const;

test.describe("Docs", () => {
  for (const [path, title] of DOCS) {
    test(`renders ${path}`, async ({ page }) => {
      await page.goto(path);
      const h1 = page.getByRole("heading", { level: 1 }).first();
      await expect(h1).toBeVisible();
      if (title) await expect(h1).toHaveText(title);
      await expect(page.getByRole("navigation", { name: "Docs" })).toBeVisible();
    });
  }

  test("contracts page never invents addresses", async ({ page }) => {
    await page.goto("/docs/contracts");
    await expect(page.getByText("Not deployed").first()).toBeVisible();
    await expect(page.getByText("https://k8s.testnet.json-rpc.injective.network/")).toBeVisible();
  });
});

test.describe("Transparency", () => {
  test("lists contracts, limits, halts, suspensions and attestations", async ({ page }) => {
    await page.goto("/transparency");
    await expect(page.getByRole("heading", { level: 1, name: "Transparency" })).toBeVisible();
    for (const name of ["Contracts", "House agents and risk limits", "Guard halts log", "Suspensions", "Epoch attestations", "Security"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(page.getByText("Wash trading flag in epoch 11")).toBeVisible();
  });
});

test.describe("Status", () => {
  test("shows services, lag and last epoch", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("heading", { level: 1, name: "Status" })).toBeVisible();
    await expect(page.getByTestId("service-row")).toHaveCount(5);
    await expect(page.getByText("1 of 5 services need attention")).toBeVisible();
  });
});

test.describe("Legal", () => {
  test("terms state the eligibility rule", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
    await expect(page.getByText(/not available to US persons/).first()).toBeVisible();
  });
  test("risk disclosure covers the required points", async ({ page }) => {
    await page.goto("/risk");
    await expect(page.getByRole("heading", { level: 1, name: "Risk disclosure" })).toBeVisible();
    await expect(page.getByText(/not investment advice, offers no pooled funds/)).toBeVisible();
  });
});

test.describe("Platform", () => {
  test("sends a strict nonce CSP and security headers", async ({ request }) => {
    const res = await request.get("/arena");
    const csp = res.headers()["content-security-policy"] ?? "";
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("robots and sitemap", async ({ request }) => {
    expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap:");
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/arena");
    expect(sitemap).not.toContain("0x0000000000000000000000000000000000000000000000000000000000000001");
  });

  test("OG images render for agents and markets", async ({ request }) => {
    const html = await (await request.get("/agents/1")).text();
    const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(og).toBeTruthy();
    const img = await request.get(new URL(og!).pathname + new URL(og!).search);
    expect(img.headers()["content-type"]).toContain("image/png");
    const mhtml = await (await request.get(`/markets/0x${"0".repeat(63)}1`)).text();
    expect(mhtml).toContain('property="og:image"');
  });

  test("organization structured data is present", async ({ request }) => {
    const html = await (await request.get("/arena")).text();
    expect(html).toContain('"@type":"Organization"');
  });

  test("light mode is a real theme and persists", async ({ page }) => {
    await page.goto("/arena");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(244, 246, 249)");
  });
});
