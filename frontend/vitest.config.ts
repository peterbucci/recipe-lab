import react from "@vitejs/plugin-react";
import { defineConfig, defineProject } from "vitest/config";

export const NODE_TEST_INCLUDE = [
  "lib/**/*.test.ts",
  "performance/**/*.test.ts",
  "scripts/**/*.test.{mjs,ts}",
  "server/**/*.test.{mjs,ts}",
  "tests/{config,contracts}/**/*.test.{mjs,ts}",
] as const;

// These colocated library tests deliberately exercise cookies, session storage,
// browser events, or the browser transport. All other lib tests stay in Node.
export const JSDOM_LIBRARY_TEST_INCLUDE = [
  "lib/api-transport/browser.test.ts",
  "lib/auth-api.test.ts",
  "lib/ingredient-catalog-api.test.ts",
  "lib/interaction-api.test.ts",
  "lib/member-activity-api.test.ts",
  "lib/member-follow-api.test.ts",
  "lib/ordinary-api-error-boundary.test.ts",
  "lib/recipe-category-client-api.test.ts",
  "lib/recipe-draft-api.test.ts",
  "lib/recipe-draft-creation-attempt.test.ts",
  "lib/recipe-draft-editor-entry.test.ts",
  "lib/recipe-draft-entry.test.ts",
  "lib/recipe-duplicate-api.test.ts",
  "lib/recipe-family-client-api.test.ts",
  "lib/recipe-library-api.test.ts",
  "lib/recipe-moderation-api.test.ts",
  "lib/recipe-publication-api.test.ts",
  "lib/recipe-report-api.test.ts",
  "lib/recipe-visibility-api.test.ts",
] as const;

export const JSDOM_TEST_INCLUDE = [
  "app/**/*.test.{ts,tsx}",
  ...JSDOM_LIBRARY_TEST_INCLUDE,
] as const;

export const VITEST_PROJECT_NAMES = {
  jsdom: "jsdom",
  node: "node",
} as const;

export const COVERAGE_SOURCE_INCLUDE = [
  "app/**/*.{ts,tsx}",
  "lib/**/*.ts",
  "server/**/*.{mjs,ts}",
  "server.mjs",
] as const;

export const COVERAGE_SOURCE_EXCLUDE = [
  "**/*.test.{mjs,ts,tsx}",
  "**/*.d.{mts,ts}",
  "app/**/*-test-support.{ts,tsx}",
  "lib/api-contracts/generated.ts",
] as const;

export const COVERAGE_REPORTERS = ["text", "json-summary", "lcov"] as const;

export default defineConfig({
  test: {
    // A bounded worker pool avoids resource-contention timeouts on high-core
    // developer and CI hosts while retaining file-level parallelism.
    maxWorkers: 4,
    coverage: {
      clean: true,
      exclude: [...COVERAGE_SOURCE_EXCLUDE],
      include: [...COVERAGE_SOURCE_INCLUDE],
      provider: "v8",
      reporter: [...COVERAGE_REPORTERS],
      reportsDirectory: "coverage",
    },
    projects: [
      defineProject({
        test: {
          name: VITEST_PROJECT_NAMES.node,
          environment: "node",
          include: [...NODE_TEST_INCLUDE],
          exclude: [...JSDOM_LIBRARY_TEST_INCLUDE],
        },
      }),
      defineProject({
        plugins: [react()],
        test: {
          name: VITEST_PROJECT_NAMES.jsdom,
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [...JSDOM_TEST_INCLUDE],
        },
      }),
    ],
  },
});
