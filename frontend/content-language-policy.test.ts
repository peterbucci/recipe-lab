import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(FRONTEND_ROOT, "..");
const APP_ROOT = resolve(FRONTEND_ROOT, "app");

type RuleId =
  | "consumer-recommendation-language"
  | "future-personalization-claim"
  | "internal-recipe-language"
  | "catalog-internals"
  | "staff-identifiers";

interface CopyFragment {
  line: number;
  text: string;
}

interface Violation extends CopyFragment {
  file: string;
  rule: RuleId;
}

const COPY_NAME_PARTS = new Set([
  "alt",
  "announcement",
  "caption",
  "content",
  "copy",
  "description",
  "error",
  "eyebrow",
  "heading",
  "hint",
  "label",
  "lede",
  "message",
  "notice",
  "placeholder",
  "prompt",
  "status",
  "summary",
  "text",
  "title",
  "warning",
]);

function nameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function isCopyName(name: string): boolean {
  const part = nameParts(name).at(-1);
  if (!part) return false;
  if (COPY_NAME_PARTS.has(part)) return true;
  if (part === "copies") return true;
  return part.endsWith("s") && COPY_NAME_PARTS.has(part.slice(0, -1));
}

function isCopySetter(name: string): boolean {
  return /^set[A-Z]/.test(name) && isCopyName(name.slice(3));
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression)) {
    return node.expression.text;
  }
  return undefined;
}

const RULES: ReadonlyArray<{ id: RuleId; pattern: RegExp }> = [
  {
    id: "consumer-recommendation-language",
    pattern: /\brecommendations?\b/i,
  },
  {
    id: "future-personalization-claim",
    pattern:
      /remember(?:s|ed)? what worked|learned substitutions?|personal intelligence|outcome[- ]based recommendations?|picked for you|tailored to your cooking|learn(?:s|ed|ing)? (?:your|a member'?s) (?:taste|preferences?)/i,
  },
  {
    id: "internal-recipe-language",
    pattern: /\b(?:forks?|lineage|snapshots?|immutable|moderation[- ]hidden)\b/i,
  },
  {
    id: "catalog-internals",
    pattern:
      /\b(?:canonical (?:ids?|identity|names?)|ingredient occurrence(?: ids?)?|policy versions?|fingerprints?|uuids?)\b/i,
  },
  {
    id: "staff-identifiers",
    pattern:
      /\b(?:case|member|recipe|request|user) (?:id|identifier|uuid)\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
];

// These modules are access-controlled staff surfaces. Exceptions are per rule:
// no staff page is allowed to make consumer recommendation claims or to use
// internal recipe-version language merely because it is staff-only.
const STAFF_DIAGNOSTIC_EXCEPTIONS: Readonly<Record<string, ReadonlySet<RuleId>>> = {
  "app/catalog/ingredient-requests/loading.tsx": new Set([
    "catalog-internals",
    "staff-identifiers",
  ]),
  "app/catalog/ingredient-requests/page.tsx": new Set([
    "catalog-internals",
    "staff-identifiers",
  ]),
  "app/components/ingredient-request-review-workspace.tsx": new Set([
    "catalog-internals",
    "staff-identifiers",
  ]),
  "app/components/recipe-moderation-workspace.tsx": new Set(["staff-identifiers"]),
  "app/moderation/recipes/loading.tsx": new Set(["staff-identifiers"]),
  "app/moderation/recipes/page.tsx": new Set(["staff-identifiers"]),
};

function repositoryPath(path: string): string {
  return relative(FRONTEND_ROOT, path).split(sep).join("/");
}

function ordinaryUiFiles(directory = APP_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return ordinaryUiFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [path];
  });
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function collectPublicCopy(source: string, fileName = "surface.tsx"): CopyFragment[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const fragments: CopyFragment[] = [];
  const seen = new Set<string>();
  const helperDefinitions = new Map<
    string,
    ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction
  >();
  const staticValueDefinitions = new Map<string, ts.Expression>();
  const resolvingStaticValues = new Set<string>();
  const publicHelperNames = new Set<string>();

  function add(node: ts.Node, text: string) {
    const normalized = normalizedText(text);
    if (!normalized) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const key = `${line}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    fragments.push({ line, text: normalized });
  }

  function collectLiterals(node: ts.Node | undefined, resolveStaticIdentifiers = true): void {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      if (!resolveStaticIdentifiers) return;
      const initializer = staticValueDefinitions.get(node.text);
      if (
        initializer &&
        isStaticCopyExpression(initializer) &&
        !resolvingStaticValues.has(node.text)
      ) {
        resolvingStaticValues.add(node.text);
        collectLiterals(initializer);
        resolvingStaticValues.delete(node.text);
      }
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      add(node.head, node.head.text);
      for (const span of node.templateSpans) {
        collectLiterals(span.expression, resolveStaticIdentifiers);
        add(span.literal, span.literal.text);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collectLiterals(node.whenTrue, resolveStaticIdentifiers);
      collectLiterals(node.whenFalse, resolveStaticIdentifiers);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        collectLiterals(node.right, resolveStaticIdentifiers);
        return;
      }
      if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.CommaToken
      ) {
        collectLiterals(node.left, resolveStaticIdentifiers);
        collectLiterals(node.right, resolveStaticIdentifiers);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) collectLiterals(argument, false);
      return;
    }
    if (ts.isJsxText(node)) {
      add(node, node.text);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (isCopyName(name)) collectLiterals(node.initializer);
      return;
    }
    ts.forEachChild(node, collectLiterals);
  }

  function isStaticCopyExpression(
    node: ts.Expression,
    seen = new Set<string>(),
  ): boolean {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      return true;
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return isStaticCopyExpression(node.expression, seen);
    }
    if (ts.isConditionalExpression(node)) {
      return (
        isStaticCopyExpression(node.whenTrue, new Set(seen)) ||
        isStaticCopyExpression(node.whenFalse, new Set(seen))
      );
    }
    if (ts.isBinaryExpression(node)) {
      if (
        node.operatorToken.kind !== ts.SyntaxKind.PlusToken &&
        node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
        node.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
        node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken &&
        node.operatorToken.kind !== ts.SyntaxKind.CommaToken
      ) {
        return false;
      }
      return (
        isStaticCopyExpression(node.left, new Set(seen)) ||
        isStaticCopyExpression(node.right, new Set(seen))
      );
    }
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return false;
      const initializer = staticValueDefinitions.get(node.text);
      if (!initializer) return false;
      const nextSeen = new Set(seen);
      nextSeen.add(node.text);
      return isStaticCopyExpression(initializer, nextSeen);
    }
    return false;
  }

  function collectReferencedHelpers(node: ts.Node | undefined, names = publicHelperNames): void {
    if (!node) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.add(node.expression.text);
    }
    ts.forEachChild(node, (child) => collectReferencedHelpers(child, names));
  }

  function returnedExpressions(
    helper: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
  ): ts.Expression[] {
    if (ts.isArrowFunction(helper) && !ts.isBlock(helper.body)) return [helper.body];
    if (!helper.body) return [];

    const expressions: ts.Expression[] = [];
    function visitReturns(node: ts.Node): void {
      if (
        node !== helper &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node))
      ) {
        return;
      }
      if (ts.isReturnStatement(node)) {
        if (node.expression) expressions.push(node.expression);
        return;
      }
      ts.forEachChild(node, visitReturns);
    }
    visitReturns(helper.body);
    return expressions;
  }

  // This is deliberately a static-copy scanner. It follows literal-producing
  // helpers used in rendered copy, custom copy props, and Next.js metadata, but
  // it does not evaluate API data, identifiers, template substitutions, or
  // runtime-generated IDs. Rendered/component tests own that dynamic boundary.
  function indexPublicCopy(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) {
      helperDefinitions.set(node.name.text, node);
      if (node.name.text === "generateMetadata") publicHelperNames.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
    ) {
      helperDefinitions.set(node.name.text, node.initializer);
      if (node.name.text === "generateMetadata") publicHelperNames.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      staticValueDefinitions.set(node.name.text, node.initializer);
    }
    if (ts.isJsxAttribute(node)) {
      if (isCopyName(node.name.getText(sourceFile))) {
        collectReferencedHelpers(node.initializer);
      }
      return;
    }
    if (ts.isJsxExpression(node)) {
      collectReferencedHelpers(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && isCopyName(name)) collectReferencedHelpers(node.initializer);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isCopyName(node.name.text) || node.name.text === "metadata") {
        collectReferencedHelpers(node.initializer);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (isCopySetter(node.expression.text)) {
        for (const argument of node.arguments) collectReferencedHelpers(argument);
      }
    }
    ts.forEachChild(node, indexPublicCopy);
  }

  indexPublicCopy(sourceFile);
  const pendingHelpers = [...publicHelperNames];
  const expandedHelpers = new Set<string>();
  while (pendingHelpers.length > 0) {
    const helperName = pendingHelpers.shift();
    if (!helperName || expandedHelpers.has(helperName)) continue;
    expandedHelpers.add(helperName);
    const helper = helperDefinitions.get(helperName);
    if (!helper) continue;
    for (const expression of returnedExpressions(helper)) {
      const referenced = new Set<string>();
      collectReferencedHelpers(expression, referenced);
      for (const reference of referenced) {
        if (!expandedHelpers.has(reference)) pendingHelpers.push(reference);
      }
    }
  }
  for (const helperName of expandedHelpers) {
    const helper = helperDefinitions.get(helperName);
    if (!helper) continue;
    for (const expression of returnedExpressions(helper)) collectLiterals(expression);
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      add(node, node.text);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (isCopyName(name)) collectLiterals(node.initializer);
      return;
    }
    if (ts.isJsxExpression(node)) {
      collectLiterals(node.expression);
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (isCopySetter(node.expression.text)) {
        for (const argument of node.arguments) collectLiterals(argument);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isCopyName(node.name.text) || node.name.text === "metadata") {
        collectLiterals(node.initializer);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && isCopyName(name)) collectLiterals(node.initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return fragments;
}

function findViolations(file: string, source: string): Violation[] {
  const allowed = STAFF_DIAGNOSTIC_EXCEPTIONS[file] ?? new Set<RuleId>();
  return collectPublicCopy(source, file).flatMap((fragment) =>
    RULES.flatMap((rule) =>
      !allowed.has(rule.id) && rule.pattern.test(fragment.text)
        ? [{ ...fragment, file, rule: rule.id }]
        : [],
    ),
  );
}

function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(({ file, line, rule, text }) => `${file}:${line} [${rule}] ${text}`)
    .join("\n");
}

describe("public product language policy", () => {
  it("keeps public positioning limited to the shipped cook experience", () => {
    const read = (path: string) =>
      readFileSync(resolve(REPOSITORY_ROOT, path), "utf8").replace(/\r\n/g, "\n");
    const readme = read("README.md");

    expect(readme).toContain(
      "Find recipes, make your own version, compare what changed, and follow recipe\nhistory.",
    );
    expect(readme).toContain(
      "Research-preview engineering capabilities, which are not consumer product\nsurfaces",
    );
    expect(readme).toContain("[product language and recommendation boundary](docs/product-language.md)");

    const publicReadme = readme.split("### Research preview:", 1)[0];
    const positioningSources = [
      "frontend/app/layout.tsx",
      "frontend/app/onboarding/page.tsx",
      "frontend/app/page.tsx",
      "frontend/app/sign-in/page.tsx",
    ].map((path) => read(path));
    positioningSources.unshift(publicReadme);
    const unsupportedClaims =
      /remember(?:s|ed)? what worked|learned substitutions?|personal intelligence|outcome[- ]based recommendations?|picked for you|tailored to your cooking|get recommendations shaped by your activity/i;

    for (const source of positioningSources) expect(source).not.toMatch(unsupportedClaims);
  });

  it("uses the preferred relationship and similarity labels", () => {
    const home = readFileSync(resolve(APP_ROOT, "page.tsx"), "utf8");
    const detail = readFileSync(resolve(APP_ROOT, "components/recipe-detail-view.tsx"), "utf8");
    const similarity = readFileSync(
      resolve(APP_ROOT, "components/recipe-duplicate-preflight-review.tsx"),
      "utf8",
    );

    expect(home).toContain("Your version");
    expect(detail).toContain("Based on");
    expect(detail).toContain("Recipe history");
    expect(similarity).toContain("Similar recipes");
  });

  it("inventories ordinary UI automatically and keeps exceptions narrow", () => {
    const files = ordinaryUiFiles();
    const inventory = new Set(files.map(repositoryPath));
    for (const exception of Object.keys(STAFF_DIAGNOSTIC_EXCEPTIONS)) {
      expect(inventory, `${exception} must remain an explicit, existing UI module`).toContain(
        exception,
      );
    }

    const violations = files.flatMap((path) => {
      const file = repositoryPath(path);
      return findViolations(file, readFileSync(path, "utf8"));
    });
    expect(formatViolations(violations)).toBe("");
  });

  it("catches prohibited copy without confusing code identifiers for copy", () => {
    const ordinary = findViolations(
      "app/components/example.tsx",
      `
        const forkHref = "/recipes/example/fork";
        const fingerprint = "internal-retry-key";
        export function Example() {
          return <p>Get recommendations shaped by your activity from this immutable snapshot.</p>;
        }
      `,
    );
    expect(ordinary.map(({ rule }) => rule)).toEqual([
      "consumer-recommendation-language",
      "internal-recipe-language",
    ]);

    const staff = findViolations(
      "app/components/ingredient-request-review-workspace.tsx",
      `export function Staff() {
        return <><p>Canonical identity</p><p>Get recommendations shaped by your activity.</p></>;
      }`,
    );
    expect(staff.map(({ rule }) => rule)).toEqual(["consumer-recommendation-language"]);
  });

  it("checks UUID-shaped copy and statically initialized rendered aliases", () => {
    const visibleUuid = "99999999-9999-4999-8999-999999999999";
    const hiddenUuid = "88888888-8888-4888-8888-888888888888";
    const violations = findViolations(
      "app/components/example.tsx",
      `
        const forkHref = "/recipes/example/fork";
        const hiddenRecipeId = "${hiddenUuid}";
        export function Example() {
          const cta = "Fork this recipe";
          const visibleRecipeReference = "${visibleUuid}";
          return <>{forkHref ? <span>Ready</span> : null}<button>{cta}</button><p>{visibleRecipeReference}</p></>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "staff-identifiers",
    ]);
    expect(violations.map(({ text }) => text)).toEqual([
      "Fork this recipe",
      visibleUuid,
    ]);
    expect(formatViolations(violations)).not.toContain(hiddenUuid);
    expect(formatViolations(violations)).not.toContain("/recipes/example/fork");
  });

  it("checks custom copy props and static metadata objects", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        export const metadata = {
          title: "Immutable snapshot",
          description: "Get recommendations shaped by your activity",
        };
        export function Example() {
          return <Panel eyebrow="Canonical identity" primaryActionLabel="Case identifier" />;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "consumer-recommendation-language",
      "catalog-internals",
      "staff-identifiers",
    ]);
  });

  it("follows static copy returned by rendered helpers and metadata helpers", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        function relationshipGuidance(usePrimary: boolean) {
          if (usePrimary) return "Immutable snapshot";
          return secondaryGuidance();
        }
        function secondaryGuidance() {
          return "Canonical identity";
        }
        function buildMetadata() {
          return { description: "Recommendations picked for you" };
        }
        export function generateMetadata() {
          return buildMetadata();
        }
        export function Example() {
          return <p>{relationshipGuidance(true)}</p>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "consumer-recommendation-language",
      "future-personalization-claim",
      "catalog-internals",
    ]);
  });

  it("checks camel-case copy variables, plural copy maps, and setters", () => {
    const violations = findViolations(
      "app/components/example.tsx",
      `
        export function Example() {
          const emptyStateEyebrow = "Immutable snapshot";
          const statusLabels = { fallback: "Case identifier" };
          setPublicationStatusMessage("Canonical identity selected");
          return <p>{emptyStateEyebrow}{statusLabels.fallback}</p>;
        }
      `,
    );

    expect(violations.map(({ rule }) => rule)).toEqual([
      "internal-recipe-language",
      "staff-identifiers",
      "catalog-internals",
    ]);
  });

  it("leaves dynamic values to rendered tests but checks their static copy frame", () => {
    const dynamicOnly = findViolations(
      "app/components/example.tsx",
      `
        export function Example({ recipeId, policyVersion }) {
          return <Panel label={recipeId} eyebrow={policyVersion} />;
        }
      `,
    );
    expect(dynamicOnly).toEqual([]);

    const runtimeAlias = findViolations(
      "app/components/example.tsx",
      `
        export function Example() {
          const cta = loadRuntimeCopy();
          return <p>{cta}</p>;
        }
      `,
    );
    expect(runtimeAlias).toEqual([]);

    const staticFrame = findViolations(
      "app/components/example.tsx",
      `
        export function Example({ recipeId, policyVersion }) {
          return (
            <Panel
              label={\`Case identifier \${recipeId}\`}
              message={\`Policy version \${policyVersion}\`}
            />
          );
        }
      `,
    );
    expect(staticFrame.map(({ rule }) => rule)).toEqual([
      "staff-identifiers",
      "catalog-internals",
    ]);
  });
});
