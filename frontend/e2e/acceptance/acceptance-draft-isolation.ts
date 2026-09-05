import { randomUUID } from "node:crypto";

import { test as base, type Page, type Response } from "@playwright/test";

import {
  type MemberName,
  useAcceptanceMember as applyAcceptanceMember,
} from "./acceptance-session";

export { expect } from "@playwright/test";

export interface SourceDraftScope {
  assertFresh(memberName: MemberName, sourceId: string): Promise<void>;
  trackExplicit(memberName: MemberName, sourceId: string, draftId: string): void;
}

interface RegisteredSource {
  memberName: MemberName;
  sourceId: string;
  userId: string;
  sessionToken: string;
}

interface TrackedDraft {
  source: RegisteredSource;
  draftId: string;
}

class IsolationError extends Error {}

function fail(stage: string): never {
  // These fixed messages must never include response bodies, credentials, or draft content.
  throw new IsolationError(`Source draft isolation failed: ${stage}.`);
}

async function safely<T>(stage: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof IsolationError) throw error;
    return fail(stage);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function activeDraft(value: unknown, sourceId: string, draftId?: string): {
  id: string;
  revision: number;
} {
  if (
    !isRecord(value) || !isUuid(value.id) ||
    (draftId !== undefined && value.id !== draftId) ||
    value.source_version_id !== sourceId || value.status !== "active" ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
  ) fail("active draft identity, source, status, or revision mismatch");
  return { id: value.id, revision: value.revision as number };
}

async function isTerminalNotFound(response: {
  status(): number;
  json(): Promise<unknown>;
}): Promise<boolean> {
  if (response.status() !== 404) return false;
  const payload: unknown = await response.json();
  return isRecord(payload) && isRecord(payload.error) &&
    payload.error.code === "recipe_draft_not_found";
}

class AcceptanceSourceDraftScope implements SourceDraftScope {
  private readonly baseUrl: URL;
  private readonly sources = new Map<string, RegisteredSource>();
  private readonly drafts = new Map<string, TrackedDraft>();
  private readonly captures = new Set<Promise<void>>();
  private captureFailed = false;

  constructor(private readonly page: Page) {
    this.baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000");
    if (this.baseUrl.protocol !== "http:" || this.baseUrl.hostname !== "127.0.0.1") {
      fail("isolated loopback frontend required");
    }
    page.on("response", this.onResponse);
  }

  async assertFresh(memberName: MemberName, sourceId: string): Promise<void> {
    if (!isUuid(sourceId)) fail("invalid source identity");
    await safely("freshness check unavailable", async () => {
      const member = await applyAcceptanceMember(this.page, memberName);
      const url = new URL("/api/recipe-drafts", this.baseUrl);
      url.search = new URLSearchParams({ source_version_id: sourceId, page: "1", page_size: "1" }).toString();
      const response = await this.page.request.get(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (response.status() !== 200) fail("freshness check rejected");
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) || !Array.isArray(payload.items) ||
        !Number.isSafeInteger(payload.total) || (payload.total as number) < 0 ||
        payload.page !== 1 || payload.page_size !== 1 ||
        !Number.isSafeInteger(payload.total_pages) || (payload.total_pages as number) < 0
      ) fail("invalid freshness response");
      if (payload.total !== 0 || payload.items.length !== 0) {
        fail("pre-existing active member/source draft found");
      }
      if (payload.total_pages !== 0) fail("invalid empty freshness response");
      this.sources.set(`${memberName}:${sourceId}`, {
        memberName, sourceId, userId: member.user_id, sessionToken: member.session_token,
      });
    });
  }

  trackExplicit(memberName: MemberName, sourceId: string, draftId: string): void {
    const source = this.sources.get(`${memberName}:${sourceId}`);
    if (!source) fail("creation tracking requires a successful freshness check");
    this.track(source, draftId);
  }

  private track(source: RegisteredSource, draftId: string): void {
    if (!isUuid(draftId)) fail("invalid created draft identity");
    const previous = this.drafts.get(draftId);
    if (previous && (previous.source.userId !== source.userId ||
      previous.source.sourceId !== source.sourceId)) {
      fail("created draft ownership or source changed");
    }
    this.drafts.set(draftId, { source, draftId });
  }

  private readonly onResponse = (response: Response): void => {
    const capture = this.capture(response).catch(() => {
      this.captureFailed = true;
    });
    this.captures.add(capture);
    void capture.finally(() => this.captures.delete(capture));
  };

  private async capture(response: Response): Promise<void> {
    const request = response.request();
    const url = new URL(request.url());
    if (request.method() !== "POST" || response.status() !== 201 ||
      url.origin !== this.baseUrl.origin || url.pathname !== "/api/recipe-drafts") return;
    const input: unknown = request.postDataJSON();
    if (!isRecord(input) || typeof input.source_version_id !== "string") return;
    const candidates = [...this.sources.values()].filter((source) =>
      source.sourceId === input.source_version_id);
    if (candidates.length === 0) return;
    const headers = await request.allHeaders();
    const sessionCookies = (headers.cookie ?? "").split(";").map((cookie) => cookie.trim())
      .filter((cookie) => cookie.startsWith("recipe_lab_session="));
    const sources = candidates.filter((source) =>
      sessionCookies.length === 1 && sessionCookies[0] === `recipe_lab_session=${source.sessionToken}`);
    if (sources.length !== 1) fail("created draft member session mismatch");
    const source = sources[0];
    const draft = activeDraft(await response.json(), source.sourceId);
    this.track(source, draft.id);
  }

  async cleanup(): Promise<void> {
    this.page.off("response", this.onResponse);
    await Promise.all(this.captures);
    let cleanupFailed = false;
    for (const tracked of this.drafts.values()) {
      try {
        await this.cleanupDraft(tracked);
      } catch {
        cleanupFailed = true;
      }
    }
    if (this.captureFailed) fail("created draft response could not be safely tracked");
    if (cleanupFailed) fail("tracked draft cleanup could not be safely completed");
  }

  private async cleanupDraft({ source, draftId }: TrackedDraft): Promise<void> {
    const member = await applyAcceptanceMember(this.page, source.memberName);
    if (member.user_id !== source.userId) fail("cleanup member identity changed");
    const url = new URL(`/api/recipe-drafts/${draftId}`, this.baseUrl);
    // Detail reads are owner-scoped and return only active drafts. Published and
    // discarded shells are not readable; only their exact not-found code is terminal.
    const response = await this.page.request.get(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (await isTerminalNotFound(response)) return;
    if (response.status() !== 200) fail("tracked draft lookup rejected");
    const draft = activeDraft(await response.json(), source.sourceId, draftId);
    url.search = new URLSearchParams({ revision: String(draft.revision) }).toString();
    const discarded = await this.page.request.delete(url.toString(), {
      headers: {
        Accept: "application/json",
        Origin: this.baseUrl.origin,
        "Idempotency-Key": randomUUID(),
        "X-CSRF-Token": member.csrf_token,
      },
    });
    if (discarded.status() !== 204 && !(await isTerminalNotFound(discarded))) {
      fail("tracked draft discard rejected");
    }
  }
}

export const test = base.extend<{ sourceDrafts: SourceDraftScope }>({
  sourceDrafts: async ({ page }, runTest) => {
    const scope = new AcceptanceSourceDraftScope(page);
    try {
      await runTest(scope);
    } finally {
      await scope.cleanup();
    }
  },
});
