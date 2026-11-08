import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the dev server with mock data (no NEXT_PUBLIC_STRATA_API), so every page renders
 * deterministic MOCK data and the MOCK notice. Next 16 runs one dev server per app directory,
 * so an already running server on the same port is reused.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev --port ${PORT}`,
        url: `${baseURL}/arena`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { NEXT_PUBLIC_STRATA_API: "" },
      },
});
