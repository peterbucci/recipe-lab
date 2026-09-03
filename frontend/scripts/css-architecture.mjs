import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CSS_LAYER_ORDER = Object.freeze([
  "tokens",
  "base",
  "shell",
  "primitives",
  "features",
  "patterns",
]);

function stylesheetPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return stylesheetPaths(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

function normalizedNewlines(source) {
  return source.replaceAll("\r\n", "\n");
}

export function expectedLayerForPath(path) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.endsWith("/tokens.css")) return "tokens";
  if (normalized.endsWith("/base.css")) return "base";
  if (normalized.includes("/shell/")) return "shell";
  if (normalized.endsWith("/primitives.css")) return "primitives";
  if (normalized.includes("/patterns/")) return "patterns";
  if (normalized.includes("/features/")) return "features";
  return null;
}

export function auditCssArchitecture(frontendDirectory) {
  const errors = [];
  const appDirectory = resolve(frontendDirectory, "app");
  const stylesDirectory = resolve(appDirectory, "styles");
  const manifestPath = resolve(appDirectory, "globals.css");
  const manifest = normalizedNewlines(readFileSync(manifestPath, "utf8"));
  const expectedDeclaration = `@layer ${CSS_LAYER_ORDER.join(", ")};`;

  if (!manifest.startsWith(`${expectedDeclaration}\n`)) {
    errors.push(`globals.css must begin with: ${expectedDeclaration}`);
  }

  const importPattern = /@import\s+["'](.+?)["'];/g;
  const imports = [...manifest.matchAll(importPattern)].map((match) => match[1]);
  const residualManifest = manifest
    .replace(expectedDeclaration, "")
    .replace(importPattern, "")
    .trim();
  if (residualManifest) {
    errors.push("globals.css may contain only the layer declaration and plain imports.");
  }

  const stylesheets = stylesheetPaths(stylesDirectory);
  const expectedImports = stylesheets.map((path) => {
    const fromApp = relative(appDirectory, path).replaceAll("\\", "/");
    return `./${fromApp}`;
  });
  for (const path of expectedImports) {
    const count = imports.filter((candidate) => candidate === path).length;
    if (count !== 1) errors.push(`${path} must be imported exactly once (found ${count}).`);
  }
  for (const path of imports) {
    if (!expectedImports.includes(path)) errors.push(`${path} is not an owned stylesheet.`);
  }

  for (const path of stylesheets) {
    const layer = expectedLayerForPath(path);
    const source = normalizedNewlines(readFileSync(path, "utf8"));
    const label = relative(frontendDirectory, path).replaceAll("\\", "/");
    if (!layer) {
      errors.push(`${label} has no recognized layer owner.`);
      continue;
    }
    const layerMatches = source.match(/@layer\s+[a-z-]+\s*\{/g) ?? [];
    if (!source.startsWith(`@layer ${layer} {\n`) || layerMatches.length !== 1) {
      errors.push(`${label} must contain one outer @layer ${layer} block.`);
    }

    if (layer === "patterns") {
      if (/!important\b/.test(source)) {
        errors.push(`${label} must not use !important.`);
      }
      if (/(^|[,{}]\s*)#[A-Za-z_][\w-]*(?=[\s.:[>+~,{])/m.test(source)) {
        errors.push(`${label} must not use ID selectors.`);
      }
    } else if (source.includes(".workspace-tab-menu")) {
      errors.push(`${label} must not style the shared workspace-tab pattern.`);
    }
  }

  return errors;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const frontendDirectory = resolve(dirname(currentFile), "..");
  const errors = auditCssArchitecture(frontendDirectory);
  if (errors.length) {
    console.error(["CSS architecture audit failed:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exitCode = 1;
  } else {
    console.log("CSS architecture audit passed.");
  }
}
