import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import vitestConfig, {
  COVERAGE_REPORTERS,
  COVERAGE_SOURCE_EXCLUDE,
  COVERAGE_SOURCE_INCLUDE,
  JSDOM_LIBRARY_TEST_INCLUDE,
  JSDOM_TEST_INCLUDE,
  NODE_TEST_INCLUDE,
  VITEST_PROJECT_NAMES,
} from "../../vitest.config";

interface InlineProject {
  plugins?: unknown[];
  test?: {
    environment?: string;
    exclude?: string[];
    include?: string[];
    name?: string;
    setupFiles?: string[];
  };
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.(?:mjs|ts|tsx)$/.test(entry.name)
      ? [relative(process.cwd(), path).split(sep).join("/")]
      : [];
  });
}

function inlineProjects(): InlineProject[] {
  const projects = vitestConfig.test?.projects ?? [];
  return projects.map((project) => {
    if (typeof project !== "object" || project === null || "then" in project) {
      throw new Error("Vitest projects must use inspectable inline configuration.");
    }
    return project as InlineProject;
  });
}

describe("Vitest runtime ownership", () => {
  it("assigns every test to one explicit Node or jsdom project", () => {
    const projects = inlineProjects();
    expect(vitestConfig.test?.maxWorkers).toBe(4);
    expect(projects.map((project) => project.test?.name)).toEqual([
      VITEST_PROJECT_NAMES.node,
      VITEST_PROJECT_NAMES.jsdom,
    ]);
    expect(projects.map((project) => project.test?.environment)).toEqual([
      "node",
      "jsdom",
    ]);

    const nodeProject = projects[0];
    const jsdomProject = projects[1];
    expect(nodeProject.plugins ?? []).toHaveLength(0);
    expect(nodeProject.test?.setupFiles ?? []).toHaveLength(0);
    expect(nodeProject.test?.include).toEqual([...NODE_TEST_INCLUDE]);
    expect(nodeProject.test?.exclude).toEqual([...JSDOM_LIBRARY_TEST_INCLUDE]);
    expect(jsdomProject.plugins).not.toHaveLength(0);
    expect(jsdomProject.test?.setupFiles).toEqual(["./vitest.setup.ts"]);
    expect(jsdomProject.test?.include).toEqual([...JSDOM_TEST_INCLUDE]);

    const browserLibraries = new Set<string>(JSDOM_LIBRARY_TEST_INCLUDE);
    const discovered = testFiles(process.cwd());
    const nodeOwned = discovered.filter(
      (path) =>
        !browserLibraries.has(path) &&
        (/^lib\/.+\.test\.ts$/.test(path) ||
          /^(?:performance|server)\/.+\.test\.ts$/.test(path) ||
          /^scripts\/.+\.test\.(?:mjs|ts)$/.test(path) ||
          /^tests\/(?:config|contracts)\/.+\.test\.(?:mjs|ts)$/.test(path)),
    );
    const jsdomOwned = discovered.filter(
      (path) =>
        browserLibraries.has(path) || /^app\/.+\.test\.(?:ts|tsx)$/.test(path),
    );
    const overlap = nodeOwned.filter((path) => jsdomOwned.includes(path));
    const owned = new Set([...nodeOwned, ...jsdomOwned]);

    expect(nodeOwned.length).toBeGreaterThan(0);
    expect(jsdomOwned.length).toBeGreaterThan(0);
    expect(overlap).toEqual([]);
    expect([...browserLibraries].sort()).toEqual(
      jsdomOwned.filter((path) => path.startsWith("lib/")).sort(),
    );
    expect([...owned].sort()).toEqual(discovered.sort());
  });

  it("collects a non-blocking production-source coverage baseline", () => {
    expect(vitestConfig.test?.coverage).toMatchObject({
      clean: true,
      exclude: [...COVERAGE_SOURCE_EXCLUDE],
      include: [...COVERAGE_SOURCE_INCLUDE],
      provider: "v8",
      reporter: [...COVERAGE_REPORTERS],
      reportsDirectory: "coverage",
    });
    expect(vitestConfig.test?.coverage).not.toHaveProperty("thresholds");
  });
});
