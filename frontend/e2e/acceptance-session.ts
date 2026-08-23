import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

type MemberName = "alice" | "bob";

interface AcceptanceMember {
  csrf_token: string;
  session_token: string;
  user_id: string;
}

interface AcceptanceSessionFixture {
  version: 1;
  members: Record<MemberName, AcceptanceMember>;
}

let fixturePromise: Promise<AcceptanceSessionFixture> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function parseMember(value: unknown): AcceptanceMember | null {
  if (!isRecord(value) || !hasExactKeys(value, ["csrf_token", "session_token", "user_id"])) {
    return null;
  }
  if (
    typeof value.user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.user_id) ||
    typeof value.session_token !== "string" ||
    !/^[A-Za-z0-9_-]{32,512}$/.test(value.session_token) ||
    typeof value.csrf_token !== "string" ||
    !/^[A-Za-z0-9_-]{32,512}$/.test(value.csrf_token)
  ) {
    return null;
  }
  return {
    csrf_token: value.csrf_token,
    session_token: value.session_token,
    user_id: value.user_id,
  };
}

async function loadFixture(): Promise<AcceptanceSessionFixture> {
  if (
    process.env.MVP_ACCEPTANCE !== "1" ||
    process.env.ACCEPTANCE_DATABASE_ISOLATED !== "1"
  ) {
    throw new Error("Acceptance member sessions require the isolated acceptance guard.");
  }
  const fixturePath = process.env.ACCEPTANCE_SESSION_FIXTURE;
  if (!fixturePath) {
    throw new Error("The guarded acceptance session fixture is unavailable.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  } catch {
    throw new Error("The guarded acceptance session fixture could not be read.");
  }
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ["members", "version"]) ||
    payload.version !== 1 ||
    !isRecord(payload.members) ||
    !hasExactKeys(payload.members, ["alice", "bob"])
  ) {
    throw new Error("The guarded acceptance session fixture has an invalid shape.");
  }
  const alice = parseMember(payload.members.alice);
  const bob = parseMember(payload.members.bob);
  if (!alice || !bob || alice.user_id === bob.user_id) {
    throw new Error("The guarded acceptance members are invalid.");
  }
  return { version: 1, members: { alice, bob } };
}

export async function useAcceptanceMember(page: Page, memberName: MemberName): Promise<void> {
  fixturePromise ??= loadFixture();
  const fixture = await fixturePromise;
  const member = fixture.members[memberName];
  const baseUrl = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
  );
  if (baseUrl.protocol !== "http:" || baseUrl.hostname !== "127.0.0.1") {
    throw new Error("Acceptance member cookies require the isolated loopback frontend.");
  }

  await page.context().addCookies([
    {
      name: "recipe_lab_session",
      value: member.session_token,
      domain: baseUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "recipe_lab_csrf",
      value: member.csrf_token,
      domain: baseUrl.hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}
