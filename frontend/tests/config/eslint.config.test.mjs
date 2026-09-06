import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const requestSource = 'export async function request() { return fetch("/api/example"); }';

describe("production API transport lint boundary", () => {
  it("keeps raw fetch forbidden when production code moves to a new owner", async () => {
    for (const filePath of [
      "features/recipes/example.ts",
      "shared/ui/example.tsx",
      "shared/navigation/example.ts",
      "shell/example.tsx",
    ]) {
      const results = await eslint.lintText(requestSource, { filePath });
      expect(
        results.flatMap(({ messages }) => messages.map(({ ruleId }) => ruleId)),
        filePath,
      ).toContain("no-restricted-globals");
    }
  });

  it("retains the reviewed executor and streaming proxy exceptions", async () => {
    for (const filePath of ["shared/api/core.ts", "server/api-proxy.ts"]) {
      const results = await eslint.lintText(requestSource, { filePath });
      expect(
        results.flatMap(({ messages }) => messages.map(({ ruleId }) => ruleId)),
        filePath,
      ).not.toContain("no-restricted-globals");
    }
  });
});
