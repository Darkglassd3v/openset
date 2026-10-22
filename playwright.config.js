// UI tests in a real browser: the system Chrome, no browser download (npm run e2e)
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "e2e",
  timeout: 30000,
  retries: 0,
  reporter: "list",
  use: { channel: "chrome", headless: true },
});
