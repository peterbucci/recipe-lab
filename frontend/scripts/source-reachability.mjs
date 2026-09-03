import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const NEXT_ENTRY_BASENAMES = new Set([
  "apple-icon",
  "default",
  "error",
  "global-error",
  "icon",
  "layout",
  "loading",
  "manifest",
  "not-found",
  "opengraph-image",
  "page",
  "robots",
  "route",
  "sitemap",
  "template",
  "twitter-image",
]);

function normalized(path) {
  return resolve(path).replaceAll("\\", "/");
}

function productionSource(path) {
  return (
    SOURCE_EXTENSIONS.includes(extname(path)) &&
    !/\.(?:test|spec)\.[^.]+$/.test(path) &&
    !/\.d\.(?:ts|mts|cts)$/.test(path)
  );
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : productionSource(path) ? [path] : [];
  });
}

function loadTypeScript(sourceRoot) {
  const dependencyRoot = resolve(
    process.env.RECIPE_LAB_FRONTEND_DEPENDENCY_ROOT ?? sourceRoot,
  );
  const require = createRequire(pathToFileURL(join(dependencyRoot, "package.json")));
  try {
    return require("typescript");
  } catch (error) {
    throw new Error(
      `Cannot load the locked TypeScript dependency from ${dependencyRoot}. Run npm ci first.`,
      { cause: error },
    );
  }
}

function moduleSpecifiers(ts, path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function resolveInternalImport(sourceRoot, importer, specifier, sources) {
  let base;
  if (specifier.startsWith("@/")) {
    base = join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(importer), specifier);
  } else {
    return undefined;
  }

  const candidates = [base];
  if (!SOURCE_EXTENSIONS.includes(extname(base))) {
    candidates.push(
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    );
  }
  return candidates.map(normalized).find((candidate) => sources.has(candidate));
}

export function auditSourceReachability(
  sourceRoot = resolve(process.env.RECIPE_LAB_FRONTEND_SOURCE_ROOT ?? process.cwd()),
) {
  const files = [
    ...walk(join(sourceRoot, "app")),
    ...walk(join(sourceRoot, "lib")),
    ...walk(join(sourceRoot, "server")),
    join(sourceRoot, "server.mjs"),
  ].filter((path) => existsSync(path));
  const sources = new Set(files.map(normalized));
  const entries = new Set(
    files
      .filter((path) => {
        const relativePath = relative(sourceRoot, path).replaceAll("\\", "/");
        const basename = path.slice(0, -extname(path).length).split(/[\\/]/).at(-1);
        return (
          relativePath === "server.mjs" ||
          (relativePath.startsWith("app/") && NEXT_ENTRY_BASENAMES.has(basename))
        );
      })
      .map(normalized),
  );
  if (sources.size === 0 || entries.size === 0) {
    throw new Error(
      `No frontend runtime inventory was found under ${sourceRoot}. Run this check from the frontend package.`,
    );
  }
  const ts = loadTypeScript(sourceRoot);
  const graph = new Map(
    files.map((path) => {
      const importer = normalized(path);
      const dependencies = moduleSpecifiers(ts, path)
        .map((specifier) => resolveInternalImport(sourceRoot, path, specifier, sources))
        .filter((dependency) => dependency !== undefined);
      return [importer, dependencies];
    }),
  );

  const reachable = reachableModulePaths(graph, entries);

  return {
    entries: [...entries].map((path) => relative(sourceRoot, path).replaceAll("\\", "/")).sort(),
    sources: [...sources].map((path) => relative(sourceRoot, path).replaceAll("\\", "/")).sort(),
    unreachable: [...sources]
      .filter((path) => !reachable.has(path))
      .map((path) => relative(sourceRoot, path).replaceAll("\\", "/"))
      .sort(),
  };
}

export function reachableModulePaths(graph, entries) {
  const reachable = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...(graph.get(current) ?? []));
  }
  return reachable;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = auditSourceReachability();
    if (result.unreachable.length > 0) {
      console.error("Production source modules unreachable from a reviewed runtime entry:");
      for (const path of result.unreachable) console.error(`- ${path}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Reachability inventory is complete: ${result.sources.length} modules from ${result.entries.length} runtime entries.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
