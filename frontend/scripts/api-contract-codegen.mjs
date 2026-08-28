import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const REPOSITORY_ROOT = path.resolve(FRONTEND_ROOT, "..");
const OPENAPI_PATH = path.join(REPOSITORY_ROOT, "backend", "openapi.json");

export const GENERATED_TYPES_PATH = path.join(
  FRONTEND_ROOT,
  "lib",
  "api-contracts",
  "generated.ts",
);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOpenApiDocument(source, description = "OpenAPI document") {
  let document;
  try {
    document = JSON.parse(source);
  } catch {
    throw new Error(`${description} is not valid JSON.`);
  }
  if (
    !isRecord(document) ||
    typeof document.openapi !== "string" ||
    !document.openapi.startsWith("3.1.") ||
    !isRecord(document.paths) ||
    !isRecord(document.components)
  ) {
    throw new Error(`${description} must be a complete OpenAPI 3.1 document.`);
  }
  return document;
}

export function normalizeGeneratedSource(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) {
    throw new Error(
      "Generated API contracts contain an unsupported line ending.",
    );
  }
  return normalized;
}

export async function generateApiContractArtifacts(document) {
  const ast = await openapiTS(structuredClone(document), {
    alphabetize: true,
    exportType: true,
    immutable: true,
    silent: true,
  });
  return new Map([
    [GENERATED_TYPES_PATH, `${COMMENT_HEADER}${astToString(ast)}`],
  ]);
}

async function loadCurrentDocument() {
  const source = await readFile(OPENAPI_PATH, "utf8");
  return parseOpenApiDocument(source, "backend/openapi.json");
}

async function writeArtifacts(artifacts) {
  for (const [target, contents] of artifacts) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, { encoding: "utf8" });
    console.log(`Wrote ${path.relative(FRONTEND_ROOT, target)}.`);
  }
}

async function checkArtifacts(artifacts) {
  const stale = [];
  for (const [target, expected] of artifacts) {
    let actual;
    try {
      actual = await readFile(target, "utf8");
    } catch {
      stale.push(path.relative(FRONTEND_ROOT, target));
      continue;
    }
    try {
      actual = normalizeGeneratedSource(actual);
    } catch {
      stale.push(path.relative(FRONTEND_ROOT, target));
      continue;
    }
    if (actual !== expected) stale.push(path.relative(FRONTEND_ROOT, target));
  }
  if (stale.length > 0) {
    throw new Error(
      `Generated API contracts are stale: ${stale.join(", ")}. Run npm run api:contracts:generate and review the diff.`,
    );
  }
  console.log("Generated API contracts match backend/openapi.json.");
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "check";
  if (!new Set(["check", "generate"]).has(command) || argv.length > 1) {
    throw new Error(
      "Usage: node scripts/api-contract-codegen.mjs [check|generate]",
    );
  }
  const artifacts = await generateApiContractArtifacts(
    await loadCurrentDocument(),
  );
  if (command === "generate") {
    await writeArtifacts(artifacts);
    return;
  }
  await checkArtifacts(artifacts);
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
