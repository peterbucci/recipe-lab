import {
  createPlaywrightModeConfig,
  requirePlaywrightMode,
} from "./playwright.mode";

export * from "./playwright.mode";

export default createPlaywrightModeConfig(
  requirePlaywrightMode(process.env),
  process.env,
);
