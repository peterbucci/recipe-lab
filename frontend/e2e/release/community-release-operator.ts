import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const backendCandidates = [
  resolve(process.cwd(), "../backend"),
  resolve(process.cwd(), "backend"),
];
const backendDirectory =
  backendCandidates.find((candidate) => existsSync(resolve(candidate, "app"))) ??
  backendCandidates[0]!;
const allowedAcceptanceDatabases = new Set([
  "recipe_lab_rcp32_acceptance",
  "recipe_lab_rcp32_acceptance_local",
]);

export function assertRcp32AcceptanceDatabase(): void {
  const configuredUrl = process.env.DATABASE_URL?.trim();
  if (!configuredUrl) {
    throw new Error("RCP-32 requires an explicit isolated PostgreSQL DATABASE_URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl);
  } catch {
    throw new Error("RCP-32 requires a valid isolated PostgreSQL DATABASE_URL.");
  }

  if (!/^postgresql(?:\+[a-z0-9][a-z0-9._-]*)?:$/i.test(parsed.protocol)) {
    throw new Error("RCP-32 accepts only an isolated PostgreSQL DATABASE_URL.");
  }
  if (!parsed.hostname || !parsed.username || parsed.pathname.split("/").length !== 2) {
    throw new Error("RCP-32 requires a complete isolated PostgreSQL DATABASE_URL.");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error("RCP-32 requires a valid isolated PostgreSQL database name.");
  }
  if (!allowedAcceptanceDatabases.has(databaseName)) {
    throw new Error("RCP-32 refuses every database except its exact disposable acceptance database.");
  }
}

function requireIsolatedAcceptance(): void {
  if (
    process.env.RCP32_ACCEPTANCE !== "1" ||
    process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1"
  ) {
    throw new Error(
      "RCP-32 operator commands require the guarded isolated acceptance environment.",
    );
  }
}

async function runOperatorCommand(
  moduleName: "app.catalog_curators" | "app.moderators",
  action: "grant" | "revoke",
  userId: string,
): Promise<void> {
  requireIsolatedAcceptance();
  assertRcp32AcceptanceDatabase();
  if (!uuidPattern.test(userId)) {
    throw new Error("RCP-32 operator commands require a valid member UUID.");
  }

  const executable = process.env.RCP32_PYTHON_EXECUTABLE ?? process.env.PYTHON ?? "python";
  try {
    await execFileAsync(
      executable,
      ["-m", moduleName, action, "--user-id", userId],
      {
        cwd: backendDirectory,
        env: process.env,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error(`The isolated ${moduleName} ${action} command failed.`);
  }
}

export async function grantCatalogCurator(userId: string): Promise<void> {
  await runOperatorCommand("app.catalog_curators", "grant", userId);
}

export async function revokeCatalogCurator(userId: string): Promise<void> {
  await runOperatorCommand("app.catalog_curators", "revoke", userId);
}

export async function grantCommunityModerator(userId: string): Promise<void> {
  await runOperatorCommand("app.moderators", "grant", userId);
}

export async function revokeCommunityModerator(userId: string): Promise<void> {
  await runOperatorCommand("app.moderators", "revoke", userId);
}
