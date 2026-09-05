import { runPlaywrightMode } from "./run-playwright-mode.mjs";

const loopbackEnvironment = Object.freeze({
  ACCEPTANCE_DATABASE_ISOLATED: "1",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:43191",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:43192",
  RECIPE_API_URL: "http://127.0.0.1:43192",
  PLAYWRIGHT_WEB_SERVER_COMMAND: "node scripts/playwright-discovery-only.mjs",
  DATABASE_URL:
    "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_acceptance",
});

const modes = [
  ["smoke", {}],
  [
    "acceptance",
    {
      ...loopbackEnvironment,
      MVP_ACCEPTANCE: "1",
      ACCEPTANCE_SESSION_FIXTURE: "playwright-discovery-only.json",
    },
  ],
  [
    "performance",
    {
      ...loopbackEnvironment,
      MVP_ACCEPTANCE: "1",
      RCP34B_PERFORMANCE: "1",
      RCP34B_PERFORMANCE_MODE: "check",
    },
  ],
  [
    "release",
    {
      ...loopbackEnvironment,
      RCP32_ACCEPTANCE: "1",
      RCP32_MANIFEST_PATH: "playwright-discovery-only.json",
      OIDC_ISSUER: "http://127.0.0.1:43193",
      OIDC_CLIENT_ID: "recipe-lab-playwright-discovery",
      OIDC_REDIRECT_URI: "http://127.0.0.1:43191/api/auth/callback",
      DATABASE_URL:
        "postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance",
    },
  ],
  ["visual", {}],
];

for (const [mode, environment] of modes) {
  const result = runPlaywrightMode(mode, ["--list"], {
    encoding: "utf8",
    environment,
    stdio: "pipe",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) {
    throw result.error;
  }
  const discovered = output.match(/Total:\s+([0-9]+)\s+tests?\s+in\s+/i);
  if (result.status !== 0 || !discovered || Number(discovered[1]) === 0) {
    process.stderr.write(output);
    throw new Error(`Playwright ${mode} discovery did not select any tests.`);
  }
  process.stdout.write(`${mode}: ${discovered[1]} tests\n`);
}
