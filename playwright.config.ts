import { defineConfig, devices } from "@playwright/test";

/**
 * Essential end-to-end tests. They run against the dev server in MOCK payment mode with seeded data:
 *   npm run db:seed && npm run test:e2e
 * Uses an installed browser channel (default: Microsoft Edge, present on Windows 11) to avoid a
 * browser download; set PW_CHANNEL=chrome or run `npx playwright install chromium` and PW_CHANNEL=chromium.
 */
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "en-US",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], ...(channel === "chromium" ? {} : { channel }) } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 180_000,
        env: { PAYMENT_PROVIDER: "mock" },
      },
});
