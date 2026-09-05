import { readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REPOSITORY_ROOT = resolve(FRONTEND_ROOT, "..");
export const APP_ROOT = resolve(FRONTEND_ROOT, "app");

export type RuleId =
  | "consumer-recommendation-language"
  | "future-personalization-claim"
  | "internal-recipe-language"
  | "catalog-internals"
  | "staff-identifiers";

export interface CopyFragment {
  line: number;
  text: string;
}

export interface Violation extends CopyFragment {
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
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
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
    pattern:
      /\b(?:forks?|lineage|snapshots?|immutable|moderation[- ]hidden)\b/i,
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
export const STAFF_DIAGNOSTIC_EXCEPTIONS: Readonly<
  Record<string, ReadonlySet<RuleId>>
> = {
  "app/catalog/ingredient-requests/loading.tsx": new Set([
    "catalog-internals",
    "staff-identifiers",
  ]),
  "app/catalog/ingredient-requests/page.tsx": new Set([
    "catalog-internals",
    "staff-identifiers",
  ]),
  "app/components/ingredient-request-decision-form.tsx": new Set([
    "catalog-internals",
  ]),
  "app/components/ingredient-request-review-detail.tsx": new Set([
    "staff-identifiers",
  ]),
  "app/components/recipe-moderation-workspace.tsx": new Set([
    "staff-identifiers",
  ]),
  "app/moderation/recipes/loading.tsx": new Set(["staff-identifiers"]),
  "app/moderation/recipes/page.tsx": new Set(["staff-identifiers"]),
};

export function repositoryPath(path: string): string {
  return relative(FRONTEND_ROOT, path).split(sep).join("/");
}

export function ordinaryUiFiles(directory = APP_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return ordinaryUiFiles(path);
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".tsx") ||
      entry.name.endsWith(".test.tsx")
    ) {
      return [];
    }
    return [path];
  });
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function collectPublicCopy(
  source: string,
  fileName = "surface.tsx",
): CopyFragment[] {
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
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const key = `${line}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    fragments.push({ line, text: normalized });
  }

  function collectLiterals(
    node: ts.Node | undefined,
    resolveStaticIdentifiers = true,
  ): void {
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

  function collectReferencedHelpers(
    node: ts.Node | undefined,
    names = publicHelperNames,
  ): void {
    if (!node) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.add(node.expression.text);
    }
    ts.forEachChild(node, (child) => collectReferencedHelpers(child, names));
  }

  function returnedExpressions(
    helper: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
  ): ts.Expression[] {
    if (ts.isArrowFunction(helper) && !ts.isBlock(helper.body))
      return [helper.body];
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
      if (node.name.text === "generateMetadata")
        publicHelperNames.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isFunctionExpression(node.initializer) ||
        ts.isArrowFunction(node.initializer))
    ) {
      helperDefinitions.set(node.name.text, node.initializer);
      if (node.name.text === "generateMetadata")
        publicHelperNames.add(node.name.text);
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
        for (const argument of node.arguments)
          collectReferencedHelpers(argument);
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
    for (const expression of returnedExpressions(helper))
      collectLiterals(expression);
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

export function findViolations(file: string, source: string): Violation[] {
  const allowed = STAFF_DIAGNOSTIC_EXCEPTIONS[file] ?? new Set<RuleId>();
  return collectPublicCopy(source, file).flatMap((fragment) =>
    RULES.flatMap((rule) =>
      !allowed.has(rule.id) && rule.pattern.test(fragment.text)
        ? [{ ...fragment, file, rule: rule.id }]
        : [],
    ),
  );
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map(({ file, line, rule, text }) => `${file}:${line} [${rule}] ${text}`)
    .join("\n");
}

