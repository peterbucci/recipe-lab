import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export const PLAYWRIGHT_MODES = [
  "smoke",
  "acceptance",
  "performance",
  "release",
] as const;

export type PlaywrightMode = (typeof PLAYWRIGHT_MODES)[number];
export type Environment = Readonly<Record<string, string | undefined>>;

export const MODE_TEST_MATCH: Readonly<Record<PlaywrightMode, string>> = {
  smoke: "smoke/**/*.spec.ts",
  acceptance: "acceptance/**/*.spec.ts",
  performance: "performance/**/*.spec.ts",
  release: "release/**/*.spec.ts",
};

function requireValue(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this Playwright mode.`);
  }
  return value;
}

function requireGuard(environment: Environment, name: string): void {
  if (environment[name] !== "1") {
    throw new Error(`${name}=1 is required for this Playwright mode.`);
  }
}

function requireLoopbackHttpUrl(environment: Environment, name: string): URL {
  const value = requireValue(environment, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(`${name} must use the isolated 127.0.0.1 HTTP origin.`);
  }
  return parsed;
}

function validateGuardedStack(
  environment: Environment,
  isCi: boolean,
): void {
  requireGuard(environment, "ACCEPTANCE_DATABASE_ISOLATED");
  requireValue(environment, "PLAYWRIGHT_WEB_SERVER_COMMAND");
  const frontend = requireLoopbackHttpUrl(environment, "PLAYWRIGHT_BASE_URL");
  const publicApi = requireLoopbackHttpUrl(environment, "NEXT_PUBLIC_API_URL");
  const serverApi = requireLoopbackHttpUrl(environment, "RECIPE_API_URL");
  if (publicApi.href !== serverApi.href) {
    throw new Error(
      "NEXT_PUBLIC_API_URL and RECIPE_API_URL must identify the same isolated backend.",
    );
  }
  if (!isCi && (frontend.port === "3000" || publicApi.port === "8000")) {
    throw new Error(
      "Local guarded Playwright modes must use dedicated ports instead of the normal development app.",
    );
  }
}

function validatePostgresDatabase(
  environment: Environment,
  allowedDatabaseNames: readonly string[],
  label: string,
): void {
  const configuredUrl = requireValue(environment, "DATABASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error(`DATABASE_URL must identify the isolated ${label} PostgreSQL database.`);
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`DATABASE_URL must identify the isolated ${label} PostgreSQL database.`);
  }
  if (
    !/^postgresql(?:\+[a-z0-9][a-z0-9._-]*)?:$/i.test(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !allowedDatabaseNames.includes(databaseName)
  ) {
    throw new Error(`DATABASE_URL must identify the isolated ${label} PostgreSQL database.`);
  }
}

export function requirePlaywrightMode(environment: Environment): PlaywrightMode {
  const mode = environment.PLAYWRIGHT_MODE?.trim();
  if (!PLAYWRIGHT_MODES.some((candidate) => candidate === mode)) {
    throw new Error(
      "Choose an explicit Playwright mode with an npm test:e2e:<mode> command.",
    );
  }
  return mode as PlaywrightMode;
}

export function validatePlaywrightModeEnvironment(
  mode: PlaywrightMode,
  environment: Environment,
): void {
  if (mode === "smoke") {
    return;
  }

  const isCi = Boolean(environment.CI);
  validateGuardedStack(environment, isCi);

  if (mode === "acceptance") {
    requireGuard(environment, "MVP_ACCEPTANCE");
    requireValue(environment, "ACCEPTANCE_SESSION_FIXTURE");
    validatePostgresDatabase(
      environment,
      ["recipe_lab_acceptance", "recipe_lab_acceptance_local"],
      "MVP acceptance",
    );
    return;
  }

  if (mode === "performance") {
    requireGuard(environment, "MVP_ACCEPTANCE");
    requireGuard(environment, "RCP34B_PERFORMANCE");
    const measurementMode = environment.RCP34B_PERFORMANCE_MODE ?? "check";
    if (measurementMode !== "check" && measurementMode !== "capture") {
      throw new Error("RCP34B_PERFORMANCE_MODE must be capture or check.");
    }
    validatePostgresDatabase(
      environment,
      ["recipe_lab_acceptance", "recipe_lab_acceptance_local"],
      "MVP acceptance",
    );
    return;
  }

  requireGuard(environment, "RCP32_ACCEPTANCE");
  requireValue(environment, "RCP32_MANIFEST_PATH");
  requireLoopbackHttpUrl(environment, "OIDC_ISSUER");
  requireValue(environment, "OIDC_CLIENT_ID");
  requireLoopbackHttpUrl(environment, "OIDC_REDIRECT_URI");
  validatePostgresDatabase(
    environment,
    [
      "recipe_lab_rcp32_acceptance",
      "recipe_lab_rcp32_acceptance_local",
    ],
    "RCP-32",
  );
}

export function traceModeForRun(mode: PlaywrightMode) {
  return mode === "smoke" ? ("on-first-retry" as const) : ("off" as const);
}

export function screenshotModeForRun(mode: PlaywrightMode) {
  return mode === "smoke" ? ("only-on-failure" as const) : ("off" as const);
}

export function createPlaywrightModeConfig(
  mode: PlaywrightMode,
  environment: Environment,
): PlaywrightTestConfig {
  validatePlaywrightModeEnvironment(mode, environment);
  const isCi = Boolean(environment.CI);
  const isGuarded = mode !== "smoke";
  const baseURL = environment.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

  return defineConfig({
    testDir: "./e2e",
    testMatch: MODE_TEST_MATCH[mode],
    fullyParallel: true,
    forbidOnly: isCi,
    retries: mode === "release" ? 0 : isCi ? 2 : 0,
    // The controlled smoke fixtures are not concurrency-safe yet, and every
    // guarded mode owns state. Keep all current modes bounded to one worker.
    workers: 1,
    reporter: isCi
      ? mode === "release"
        ? [["github"]]
        : [["github"], ["html", { open: "never" }]]
      : "html",
    use: {
      baseURL,
      screenshot: screenshotModeForRun(mode),
      video: "off",
      // Guarded modes may retain cookies and CSRF headers in traces.
      trace: traceModeForRun(mode),
    },
    projects: [
      {
        name: "chromium",
        use: { ...devices["Desktop Chrome"] },
      },
    ],
    webServer: {
      command:
        environment.PLAYWRIGHT_WEB_SERVER_COMMAND ??
        "npm run dev -- --hostname 127.0.0.1",
      url: baseURL,
      reuseExistingServer: isGuarded ? false : !isCi,
      stdout: "pipe",
      timeout: 120_000,
    },
  });
}
