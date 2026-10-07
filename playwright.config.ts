import { defineConfig } from "@playwright/test";

// PW_PROD=1 runs the suite against a production build served by `next start`
// (build it first with NEXT_PUBLIC_E2E=1, which is what lets the tests read the editor store).
const prod = process.env.PW_PROD === "1";
const port = prod ? 3100 : 3000;

export default defineConfig({
  testDir: "tests/e2e",
  webServer: { command: prod ? `npx next start -p ${port}` : "npm run dev", url: `http://localhost:${port}`, reuseExistingServer: !prod },
  use: { baseURL: `http://localhost:${port}` },
});
