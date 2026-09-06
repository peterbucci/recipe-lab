import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";
import {
  COVERAGE_REPORTERS,
  COVERAGE_SOURCE_EXCLUDE,
  COVERAGE_SOURCE_INCLUDE,
  JSDOM_LIBRARY_TEST_INCLUDE,
  JSDOM_TEST_INCLUDE,
  NODE_TEST_INCLUDE,
  VITEST_PROJECT_NAMES,
} from "./vitest.shared.mts";

const serverOnlyTestAlias = {
  "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
};

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
        resolve: { alias: serverOnlyTestAlias },
        test: {
          name: VITEST_PROJECT_NAMES.node,
          environment: "node",
          include: [...NODE_TEST_INCLUDE],
          exclude: [...JSDOM_LIBRARY_TEST_INCLUDE],
        },
      }),
      defineProject({
        resolve: { alias: serverOnlyTestAlias },
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
