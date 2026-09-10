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

export const RESERVED_SELECTOR_OWNERS = Object.freeze({
  "site-header": "app/styles/shell/site-shell-auth.css",
  "site-footer": "app/styles/shell/site-shell-auth.css",
  "site-nav": "app/styles/shell/site-shell-auth.css",
  "mobile-nav": "app/styles/shell/site-shell-auth.css",
  "account-menu": "app/styles/shell/site-shell-auth.css",
  "app-shell": "app/styles/base.css",
  "workspace-empty-state": "app/styles/primitives.css",
  "workspace-panel-header": "app/styles/primitives.css",
});

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

function rulePreludes(source) {
  const preludes = [];
  let preludeStart = 0;
  let quote = null;
  let inComment = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (parentheses || brackets) continue;

    if (character === "{") {
      const prelude = source.slice(preludeStart, index).trim();
      if (prelude && !prelude.startsWith("@")) preludes.push(prelude);
      preludeStart = index + 1;
    } else if (character === "}" || character === ";") {
      preludeStart = index + 1;
    }
  }

  return preludes;
}

function selectorListArms(selectorList) {
  const arms = [];
  let armStart = 0;
  let quote = null;
  let inComment = false;
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < selectorList.length; index += 1) {
    const character = selectorList[index];
    const nextCharacter = selectorList[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (character === "," && parentheses === 0 && brackets === 0) {
      arms.push(selectorList.slice(armStart, index));
      armStart = index + 1;
    }
  }

  arms.push(selectorList.slice(armStart));
  return arms.map((arm) => arm.replace(/\/\*[\s\S]*?\*\//g, " ").trim()).filter(Boolean);
}

function reservedFamilyForClassName(className) {
  for (const family of Object.keys(RESERVED_SELECTOR_OWNERS)) {
    if (
      className === family ||
      className.startsWith(`${family}__`) ||
      className.startsWith(`${family}--`)
    ) {
      return family;
    }
  }
  return null;
}

function reservedFamilyInSelectorSubject(selector) {
  const nestedSelector = selector.startsWith("&");
  let quote = null;
  let inComment = false;
  let parentheses = 0;
  let brackets = 0;
  const ignoredFunctionDepths = [];

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    const nextCharacter = selector[index + 1];

    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (brackets) continue;
    if (character === "(") {
      parentheses += 1;
      const functionName = selector.slice(0, index).match(/:([A-Za-z-]+)\s*$/)?.[1];
      if (functionName === "not" || functionName === "has") {
        ignoredFunctionDepths.push(parentheses);
      }
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      while (ignoredFunctionDepths.at(-1) > parentheses) {
        ignoredFunctionDepths.pop();
      }
      continue;
    }
    if (
      !nestedSelector &&
      parentheses === 0 &&
      (/\s/.test(character) ||
        character === ">" ||
        character === "+" ||
        character === "~" ||
        character === "|")
    ) {
      break;
    }
    if (character !== "." || ignoredFunctionDepths.length) continue;

    const className = selector.slice(index + 1).match(/^[A-Za-z0-9_-]+/)?.[0];
    if (!className) continue;
    const family = reservedFamilyForClassName(className);
    if (family) return family;
    index += className.length;
  }

  return null;
}

export function reservedSelectorOwnershipErrors(stylesheetPath, source) {
  const normalizedPath = stylesheetPath.replaceAll("\\", "/");
  const errors = [];

  for (const prelude of rulePreludes(normalizedNewlines(source))) {
    for (const selector of selectorListArms(prelude)) {
      const family = reservedFamilyInSelectorSubject(selector);
      if (!family) continue;
      const owner = RESERVED_SELECTOR_OWNERS[family];
      if (normalizedPath === owner || normalizedPath.endsWith(`/${owner}`)) continue;
      errors.push(
        `${normalizedPath} must not own selector "${selector}"; .${family} belongs to ${owner}.`,
      );
    }
  }

  return errors;
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
    errors.push(...reservedSelectorOwnershipErrors(label, source));
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
