import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const PLAYWRIGHT_MODES = Object.freeze([
  "smoke",
  "acceptance",
  "performance",
  "release",
  "visual",
]);

export function playwrightInvocation(mode, forwardedArguments = []) {
  if (!PLAYWRIGHT_MODES.includes(mode)) {
    throw new Error(
      "Choose one explicit Playwright mode: smoke, acceptance, performance, release, or visual.",
    );
  }
  return {
    arguments: [
      "test",
      ...(mode === "visual"
        ? ["--config=playwright.baseline.config.ts"]
        : []),
      ...forwardedArguments,
    ],
    environment:
      mode === "visual" ? {} : { PLAYWRIGHT_MODE: mode },
  };
}

export function runPlaywrightMode(
  mode,
  forwardedArguments = [],
  options = {},
) {
  const invocation = playwrightInvocation(mode, forwardedArguments);
  const require = createRequire(import.meta.url);
  const playwrightCli = require.resolve("@playwright/test/cli");
  return spawnSync(process.execPath, [playwrightCli, ...invocation.arguments], {
    cwd: options.cwd ?? process.cwd(),
    encoding: options.encoding,
    env: { ...process.env, ...options.environment, ...invocation.environment },
    stdio: options.stdio ?? "inherit",
  });
}

function main() {
  const [mode, ...forwardedArguments] = process.argv.slice(2);
  try {
    const result = runPlaywrightMode(mode, forwardedArguments);
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
