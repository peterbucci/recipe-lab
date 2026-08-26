import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const isMvpAcceptance = process.env.MVP_ACCEPTANCE === "1";
const isRcp32Acceptance = process.env.RCP32_ACCEPTANCE === "1";
const isAcceptanceRun =
  (isMvpAcceptance || isRcp32Acceptance) &&
  process.env.ACCEPTANCE_DATABASE_ISOLATED === "1";
const isCi = Boolean(process.env.CI);

export function traceModeForRun(acceptanceRun: boolean) {
  return acceptanceRun ? ("off" as const) : ("on-first-retry" as const);
}

export function screenshotModeForRun(acceptanceRun: boolean) {
  return acceptanceRun ? ("off" as const) : ("only-on-failure" as const);
}

if (isAcceptanceRun) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const serverApiUrl = process.env.RECIPE_API_URL;
  const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND;

  if (!apiUrl || !serverApiUrl || !webServerCommand || !process.env.PLAYWRIGHT_BASE_URL) {
    throw new Error(
      "Guarded acceptance requires explicit frontend, backend, and web-server settings.",
    );
  }

  if (apiUrl !== serverApiUrl) {
    throw new Error(
      "NEXT_PUBLIC_API_URL and RECIPE_API_URL must identify the same isolated backend.",
    );
  }

  const frontend = new URL(baseURL);
  const backend = new URL(apiUrl);
  if (
    frontend.protocol !== "http:" ||
    frontend.hostname !== "127.0.0.1" ||
    backend.protocol !== "http:" ||
    backend.hostname !== "127.0.0.1"
  ) {
    throw new Error("Guarded acceptance requires explicit loopback frontend and backend URLs.");
  }
  if (!isCi && (frontend.port === "3000" || backend.port === "8000")) {
    throw new Error(
      "Local guarded acceptance must use dedicated ports instead of the normal development app.",
    );
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isRcp32Acceptance ? 0 : isCi ? 2 : 0,
  workers: isAcceptanceRun || isCi ? 1 : undefined,
  reporter: isCi
    ? isRcp32Acceptance
      ? [["github"]]
      : [["github"], ["html", { open: "never" }]]
    : "html",
  use: {
    baseURL,
    screenshot: screenshotModeForRun(isAcceptanceRun),
    video: "off",
    // Authenticated acceptance traces can retain Cookie and X-CSRF-Token headers.
    // Keep them disabled because test-results is uploaded as a CI diagnostic artifact.
    trace: traceModeForRun(isAcceptanceRun),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
      "npm run dev -- --hostname 127.0.0.1",
    url: baseURL,
    reuseExistingServer: isAcceptanceRun ? false : !isCi,
    stdout: "pipe",
    timeout: 120_000,
  },
});
