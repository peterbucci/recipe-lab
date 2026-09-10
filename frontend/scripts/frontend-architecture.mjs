import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export const FRONTEND_OWNERS = Object.freeze({
  routes: "app",
  features: "features",
  shared: "shared",
  shell: "shell",
  server: "server",
  legacy: "legacy",
});

const RUNTIME_ROOTS = ["app", "features", "shared", "shell", "server", "lib"];

const TYPESCRIPT_SOURCE_SUBSTITUTIONS = Object.freeze({
  ".cjs": [".cts"],
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx", ".ts"],
  ".mjs": [".mts"],
});

const REVIEWED_CROSS_FEATURE_DEPENDENCIES = Object.freeze([
  {
    importer: /^features\/account\//,
    dependency: /^features\/auth\/(?:auth-api|auth-session-provider)\.(?:ts|tsx)$/,
  },
  {
    importer: /^features\/account\/member-activity-api\.ts$/,
    dependency:
      /^features\/recipes\/authoring\/draft\/recipe-draft-summary\.ts$/,
  },
  {
    importer: /^features\/community\/cook-follow-control(?:\.test)?\.tsx$/,
    dependency: /^features\/auth\/auth-session-provider\.tsx$/,
  },
  {
    importer: /^features\/community\/public-cook-profile\.ts$/,
    dependency:
      /^features\/recipes\/shared\/recipe-(?:contracts|summary-parser)\.ts$/,
  },
  {
    importer:
      /^features\/community\/(?:community-publication-list|public-cook-attribution)\.tsx$/,
    dependency: /^features\/recipes\/shared\/recipe-contracts\.ts$/,
  },
  {
    importer: /^features\/community\/member-follow-api\.ts$/,
    dependency: /^features\/recipes\/shared\/recipe-summary-parser\.ts$/,
  },
  {
    importer:
      /^features\/community\/community-activity-timeline\.test\.tsx$/,
    dependency:
      /^features\/recipes\/shared\/recipe-(?:contracts|test-support)\.ts$/,
  },
  {
    importer:
      /^features\/moderation\/reporting\/recipe-report-access(?:\.test)?\.tsx$/,
    dependency: /^features\/auth\/auth-session-provider\.tsx$/,
  },
  {
    importer: /^features\/moderation\//,
    dependency: /^features\/recipes\/shared\//,
  },
  {
    importer: /^features\/recipes\/(?:authoring|browse|detail|library)\//,
    dependency:
      /^features\/auth\/(?:auth-api|auth-session-provider|member-route-gate)\.(?:ts|tsx)$/,
  },
  {
    importer: /^features\/recipes\/(?:browse|detail|library)\//,
    dependency:
      /^features\/community\/(?:cook-follow-control|member-follow-api|public-cook-attribution)\.(?:ts|tsx)$/,
  },
  {
    importer: /^features\/recipes\/authoring\//,
    dependency:
      /^features\/ingredients\/(?:ingredient-catalog-picker|ingredient-model)\.(?:ts|tsx)$/,
  },
  {
    importer: /^features\/recipes\/detail\//,
    dependency:
      /^features\/moderation\/reporting\/recipe-report-access\.tsx$/,
  },
]);

const REVIEWED_RECIPE_WORKFLOW_DEPENDENCIES = Object.freeze([
  {
    importer:
      /^features\/recipes\/(?:authoring|browse|detail|library)\//,
    dependency: /^features\/recipes\/shared\//,
  },
  {
    importer:
      /^features\/recipes\/library\/my-recipe-library\.tsx$/,
    dependency:
      /^features\/recipes\/authoring\/draft\/recipe-draft-api\.ts$/,
  },
  {
    importer:
      /^features\/recipes\/library\/(?:my-recipe-library\.tsx|recipe-library-model\.ts)$/,
    dependency:
      /^features\/recipes\/authoring\/draft\/recipe-draft-summary\.ts$/,
  },
  {
    importer:
      /^features\/recipes\/shared\/recipe-api-behavior\.test\.ts$/,
    dependency:
      /^features\/recipes\/(?:browse\/recipe-browse-server-api|detail\/recipe-detail-server-api)\.ts$/,
  },
]);

function normalized(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSourceFile(path) {
  return (
    SOURCE_EXTENSIONS.has(extname(path)) &&
    !/\.d\.(?:ts|mts|cts)$/.test(path)
  );
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : isSourceFile(path) ? [path] : [];
  });
}

export function ownerForPath(path) {
  const candidate = normalized(path);
  if (candidate === "server.mjs" || candidate.startsWith("server/")) {
    return { kind: FRONTEND_OWNERS.server };
  }
  if (candidate.startsWith("app/components/") || candidate.startsWith("lib/")) {
    return { kind: FRONTEND_OWNERS.legacy };
  }
  if (candidate.startsWith("app/")) return { kind: FRONTEND_OWNERS.routes };
  if (candidate.startsWith("shared/")) return { kind: FRONTEND_OWNERS.shared };
  if (candidate.startsWith("shell/")) return { kind: FRONTEND_OWNERS.shell };
  const feature = /^features\/([^/]+)\//.exec(candidate)?.[1];
  if (feature) return { kind: FRONTEND_OWNERS.features, feature };
  return undefined;
}

export function reviewedCrossFeatureDependency(importerPath, dependencyPath) {
  const importer = normalized(importerPath);
  const dependency = normalized(dependencyPath);
  return REVIEWED_CROSS_FEATURE_DEPENDENCIES.some(
    (rule) => rule.importer.test(importer) && rule.dependency.test(dependency),
  );
}

function recipeWorkflowForPath(path) {
  const segment = /^features\/recipes\/([^/]+)(?:\/|$)/.exec(
    normalized(path),
  )?.[1];
  if (!segment) return undefined;
  return segment.includes(".") ? "(root)" : segment;
}

export function reviewedRecipeWorkflowDependency(importerPath, dependencyPath) {
  const importer = normalized(importerPath);
  const dependency = normalized(dependencyPath);
  return REVIEWED_RECIPE_WORKFLOW_DEPENDENCIES.some(
    (rule) => rule.importer.test(importer) && rule.dependency.test(dependency),
  );
}

export function forbiddenDependencyReason(importerPath, dependencyPath) {
  const importer = ownerForPath(importerPath);
  const dependency = ownerForPath(dependencyPath);
  if (!importer || !dependency) {
    return undefined;
  }
  if (importer.kind === FRONTEND_OWNERS.legacy) {
    return "retired legacy source locations cannot own dependencies";
  }
  if (dependency.kind === FRONTEND_OWNERS.legacy) {
    return `${importer.kind} modules cannot depend on retired legacy source locations`;
  }
  if (
    importer.kind === FRONTEND_OWNERS.features &&
    dependency.kind === FRONTEND_OWNERS.features
  ) {
    const importerWorkflow = recipeWorkflowForPath(importerPath);
    const dependencyWorkflow = recipeWorkflowForPath(dependencyPath);
    if (
      importer.feature === "recipes" &&
      dependency.feature === "recipes"
    ) {
      if (
        importerWorkflow &&
        dependencyWorkflow &&
        importerWorkflow === dependencyWorkflow
      ) {
        return undefined;
      }
      if (reviewedRecipeWorkflowDependency(importerPath, dependencyPath)) {
        return undefined;
      }
      return `features/recipes/${importerWorkflow ?? "(unknown)"} modules cannot depend on the unreviewed features/recipes/${dependencyWorkflow ?? "(unknown)"} boundary`;
    }
    if (
      importer.feature === dependency.feature ||
      reviewedCrossFeatureDependency(importerPath, dependencyPath)
    ) {
      return undefined;
    }
    return `features/${importer.feature} modules cannot depend on the unreviewed features/${dependency.feature} boundary`;
  }
  if (
    importer.kind === FRONTEND_OWNERS.routes &&
    dependency.kind === FRONTEND_OWNERS.server &&
    /\/route(?:\.test)?\.(?:ts|tsx|js|jsx)$/.test(`/${normalized(importerPath)}`)
  ) {
    return undefined;
  }

  const allowed = {
    [FRONTEND_OWNERS.routes]: new Set([
      FRONTEND_OWNERS.routes,
      FRONTEND_OWNERS.features,
      FRONTEND_OWNERS.shared,
      FRONTEND_OWNERS.shell,
    ]),
    [FRONTEND_OWNERS.features]: new Set([FRONTEND_OWNERS.shared]),
    [FRONTEND_OWNERS.shared]: new Set([FRONTEND_OWNERS.shared]),
    [FRONTEND_OWNERS.shell]: new Set([
      FRONTEND_OWNERS.shared,
      FRONTEND_OWNERS.shell,
    ]),
    [FRONTEND_OWNERS.server]: new Set([
      FRONTEND_OWNERS.server,
      FRONTEND_OWNERS.shared,
    ]),
  }[importer.kind];

  if (allowed?.has(dependency.kind)) return undefined;
  return `${importer.kind} modules cannot depend on ${dependency.kind} modules`;
}

function loadTypeScript(sourceRoot) {
  const dependencyRoot = resolve(
    process.env.RECIPE_LAB_FRONTEND_DEPENDENCY_ROOT ?? sourceRoot,
  );
  const require = createRequire(pathToFileURL(join(dependencyRoot, "package.json")));
  return require("typescript");
}

function moduleMetadata(ts, path) {
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
      const bindings = node.importClause?.namedBindings ?? node.exportClause;
      const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly ||
        (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) && !node.importClause?.name &&
          bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly));
      specifiers.push({ specifier: node.moduleSpecifier.text, typeOnly: Boolean(typeOnly) });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push({ specifier: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return {
    imports: specifiers,
    client: source.statements.some((statement) => ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression) && statement.expression.text === "use client"),
    serverOnly: specifiers.some(({ specifier, typeOnly }) => specifier === "server-only" && !typeOnly),
  };
}

export function clientServerBoundaryErrors(graph, clients, serverModules) {
  const errors = [];
  for (const client of clients) {
    const pending = [[client]];
    const visited = new Set();
    while (pending.length) {
      const chain = pending.shift();
      const current = chain.at(-1);
      if (visited.has(current)) continue;
      visited.add(current);
      if (serverModules.has(current)) {
        errors.push(`${chain.join(" -> ")}: client code reaches a server-only module`);
        break;
      }
      for (const dependency of graph.get(current) ?? []) pending.push([...chain, dependency]);
    }
  }
  return errors;
}

export function runtimeDependencyCycleErrors(graph) {
  const errors = [];
  const emitted = new Set();
  const state = new Map();
  const stack = [];

  function visit(modulePath) {
    const currentState = state.get(modulePath);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      const cycleStart = stack.indexOf(modulePath);
      const cycle = [...stack.slice(cycleStart), modulePath];
      const members = cycle.slice(0, -1);
      const smallest = members.reduce(
        (best, candidate, index) =>
          candidate < members[best] ? index : best,
        0,
      );
      const canonicalMembers = [
        ...members.slice(smallest),
        ...members.slice(0, smallest),
      ];
      const canonical = [...canonicalMembers, canonicalMembers[0]].join(" -> ");
      if (!emitted.has(canonical)) {
        emitted.add(canonical);
        errors.push(`${canonical}: circular runtime dependency`);
      }
      return;
    }

    state.set(modulePath, "visiting");
    stack.push(modulePath);
    for (const dependency of [...(graph.get(modulePath) ?? [])].sort()) {
      if (graph.has(dependency)) visit(dependency);
    }
    stack.pop();
    state.set(modulePath, "visited");
  }

  for (const modulePath of [...graph.keys()].sort()) visit(modulePath);
  return errors.sort();
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
  const explicitExtension = extname(base);
  const substitutionStem = explicitExtension
    ? base.slice(0, -explicitExtension.length)
    : base;
  const substitutions =
    TYPESCRIPT_SOURCE_SUBSTITUTIONS[explicitExtension] ?? [];
  const candidates = [
    ...substitutions.map((extension) => `${substitutionStem}${extension}`),
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) => join(base, `index${extension}`)),
  ].map((path) => resolve(path));
  return candidates.find((candidate) => sources.has(candidate));
}

export function auditFrontendArchitecture(
  sourceRoot = resolve(process.env.RECIPE_LAB_FRONTEND_SOURCE_ROOT ?? process.cwd()),
) {
  const files = RUNTIME_ROOTS.flatMap((root) => walk(join(sourceRoot, root)));
  if (existsSync(join(sourceRoot, "server.mjs"))) files.push(join(sourceRoot, "server.mjs"));
  if (files.length === 0) {
    throw new Error(`No frontend source inventory was found under ${sourceRoot}.`);
  }

  const errors = [];
  for (const path of files) {
    const relativePath = normalized(relative(sourceRoot, path));
    const owner = ownerForPath(relativePath);
    if (!owner) errors.push(`${relativePath}: no frontend owner`);
    if (owner?.kind === FRONTEND_OWNERS.legacy) {
      errors.push(`${relativePath}: retired legacy source location is not allowed`);
    }
    if (
      owner &&
      owner.kind !== FRONTEND_OWNERS.legacy &&
      /\/(?:index)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(`/${relativePath}`)
    ) {
      errors.push(`${relativePath}: broad barrel files are not allowed`);
    }
  }

  const ts = loadTypeScript(sourceRoot);
  const sourcePaths = new Set(files.map((path) => resolve(path)));
  const metadata = new Map(files.map((path) => [path, moduleMetadata(ts, path)]));
  const runtimeGraph = new Map();
  const clients = [];
  const serverModules = new Set();
  for (const path of files) {
    const importer = normalized(relative(sourceRoot, path));
    const moduleInfo = metadata.get(path);
    const dependencies = [];
    if (moduleInfo.client) clients.push(importer);
    if (moduleInfo.serverOnly || importer === "server.mjs" || importer.startsWith("server/")) {
      serverModules.add(importer);
    }
    for (const { specifier, typeOnly } of moduleInfo.imports) {
      const dependencyPath = resolveInternalImport(
        sourceRoot,
        path,
        specifier,
        sourcePaths,
      );
      if (!dependencyPath) continue;
      const dependency = normalized(relative(sourceRoot, dependencyPath));
      if (!typeOnly) dependencies.push(dependency);
      const reason = forbiddenDependencyReason(importer, dependency);
      if (reason) errors.push(`${importer} -> ${dependency}: ${reason}`);
    }
    runtimeGraph.set(importer, dependencies);
  }
  errors.push(...clientServerBoundaryErrors(runtimeGraph, clients, serverModules));
  errors.push(...runtimeDependencyCycleErrors(runtimeGraph));

  return {
    errors: errors.sort(),
    legacy: files
      .map((path) => normalized(relative(sourceRoot, path)))
      .filter((path) => ownerForPath(path)?.kind === FRONTEND_OWNERS.legacy)
      .sort(),
    sources: files.map((path) => normalized(relative(sourceRoot, path))).sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = auditFrontendArchitecture();
    if (result.errors.length > 0) {
      console.error("Frontend architecture audit failed:");
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Frontend architecture audit passed: ${result.sources.length} source files; ${result.legacy.length} files in retired app/components and lib locations.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
