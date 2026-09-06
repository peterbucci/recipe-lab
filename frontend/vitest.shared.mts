export const NODE_TEST_INCLUDE = [
  "features/**/*.test.ts",
  "shared/api/**/*.test.ts",
  "shared/time/**/*.test.ts",
  "e2e/performance/**/*.test.ts",
  "scripts/**/*.test.{mjs,ts}",
  "server/**/*.test.{mjs,ts}",
  "tests/{config,contracts}/**/*.test.{mjs,ts}",
] as const;

// These colocated tests deliberately exercise cookies, session storage,
// browser events, or the browser transport. All other TypeScript tests in
// feature and non-UI shared owners stay in Node.
export const JSDOM_LIBRARY_TEST_INCLUDE = [
  "shared/api/browser.test.ts",
  "features/account/account-api.test.ts",
  "features/auth/auth-api.test.ts",
  "features/ingredients/catalog/ingredient-catalog-api.test.ts",
  "features/ingredients/requests/ingredient-request-api.test.ts",
  "features/ingredients/review/ingredient-request-review-api.test.ts",
  "features/recipes/detail/interaction-api.test.ts",
  "features/account/member-activity-api.test.ts",
  "features/community/member-follow-api.test.ts",
  "tests/contracts/ordinary-api-error-boundary.test.ts",
  "features/recipes/browse/recipe-category-client-api.test.ts",
  "features/recipes/authoring/draft/recipe-draft-api.test.ts",
  "features/recipes/authoring/draft/recipe-draft-creation-attempt.test.ts",
  "features/recipes/authoring/draft/recipe-draft-editor-entry.test.ts",
  "features/recipes/authoring/draft/recipe-draft-entry.test.ts",
  "features/recipes/authoring/duplicate/recipe-duplicate-api.test.ts",
  "features/recipes/shared/recipe-family-client-api.test.ts",
  "features/recipes/library/recipe-library-api.test.ts",
  "features/moderation/review/recipe-moderation-api.test.ts",
  "features/recipes/authoring/publication/recipe-publication-api.test.ts",
  "features/moderation/reporting/recipe-report-api.test.ts",
  "features/recipes/library/recipe-visibility-api.test.ts",
] as const;

export const JSDOM_TEST_INCLUDE = [
  "app/**/*.test.{ts,tsx}",
  "features/**/*.test.tsx",
  "shared/{ui,navigation}/**/*.test.{ts,tsx}",
  "shell/**/*.test.{ts,tsx}",
  ...JSDOM_LIBRARY_TEST_INCLUDE,
] as const;

export const VITEST_PROJECT_NAMES = {
  jsdom: "jsdom",
  node: "node",
} as const;

export const COVERAGE_SOURCE_INCLUDE = [
  "app/**/*.{ts,tsx}",
  "features/**/*.{ts,tsx}",
  "e2e/performance/public-performance-baseline.ts",
  "shared/**/*.{ts,tsx}",
  "shell/**/*.{ts,tsx}",
  "server/**/*.{mjs,ts}",
  "server.mjs",
] as const;

export const COVERAGE_SOURCE_EXCLUDE = [
  "**/*.test.{mjs,ts,tsx}",
  "**/*.d.{mts,ts}",
  "**/*-test-support.{ts,tsx}",
  "shared/api/generated/generated.ts",
] as const;

export const COVERAGE_REPORTERS = ["text", "json-summary", "lcov"] as const;
