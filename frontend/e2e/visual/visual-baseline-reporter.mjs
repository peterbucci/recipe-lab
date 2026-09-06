import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SCHEMA_VERSION = 1;
const SUITE_NAME = "rcp34b-deterministic-baselines";
const PROJECT_NAMES = [
  "baseline-desktop-chromium",
  "baseline-phone-chromium",
];

function safeTestId(test) {
  const title = test
    .titlePath()
    .filter((part) => part && !part.endsWith(".spec.ts"))
    .join(" / ");
  return /^[a-z0-9 /:._()-]+$/i.test(title) ? title : "redacted-test-id";
}

function emptyCounts() {
  return { total: 0, passed: 0, failed: 0, skipped: 0 };
}

export default class Rcp34bBaselineReporter {
  constructor(options = {}) {
    this.outputFile = resolve(
      process.cwd(),
      options.outputFile ?? "test-results/baseline/results.json",
    );
    this.counts = emptyCounts();
    this.projects = new Map(PROJECT_NAMES.map((name) => [name, emptyCounts()]));
    this.failures = [];
  }

  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    const projectName = test.parent.project()?.name;
    if (!PROJECT_NAMES.includes(projectName)) {
      return;
    }
    const project = this.projects.get(projectName);
    const category =
      result.status === "passed"
        ? "passed"
        : result.status === "skipped"
          ? "skipped"
          : "failed";
    this.counts.total += 1;
    this.counts[category] += 1;
    project.total += 1;
    project[category] += 1;
    if (category === "failed") {
      this.failures.push({ project: projectName, test_id: safeTestId(test) });
    }
  }

  async onEnd(result) {
    const report = {
      schema_version: SCHEMA_VERSION,
      suite: SUITE_NAME,
      status: result.status === "passed" ? "passed" : "failed",
      counts: this.counts,
      projects: PROJECT_NAMES.map((name) => ({
        name,
        ...this.projects.get(name),
      })),
      failures: this.failures.sort((left, right) =>
        `${left.project}\0${left.test_id}`.localeCompare(
          `${right.project}\0${right.test_id}`,
          "en",
        ),
      ),
    };
    await mkdir(dirname(this.outputFile), { recursive: true });
    await writeFile(this.outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}
