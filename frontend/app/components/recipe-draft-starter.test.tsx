import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recipeDraftCreationAttemptStorageKey,
  recipeDraftCreationIntent,
} from "../../lib/recipe-draft-creation-attempt";
import { RecipeDraftApiError } from "../../lib/recipe-draft-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftStarter } from "./recipe-draft-starter";

const mocks = vi.hoisted(() => ({
  createRecipeDraft: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return { ...actual, createRecipeDraft: mocks.createRecipeDraft };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FORK_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const BLANK_ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ATTEMPT_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ACTOR_ATTEMPT_ID = "77777777-7777-4777-8777-777777777777";

function seedAttempt(
  actorId: string,
  sourceVersionId: string | null,
  idempotencyKey: string,
) {
  const storageKey = recipeDraftCreationAttemptStorageKey(
    actorId,
    sourceVersionId,
  );
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({
      actor_id: actorId,
      idempotency_key: idempotencyKey,
      intent: recipeDraftCreationIntent(sourceVersionId),
      version: 1,
    }),
  );
  return storageKey;
}

function renderStarter({
  actorId = "member-a",
  sourceVersionId = SOURCE_ID,
  status = "authenticated",
  strict = false,
}: {
  actorId?: string;
  sourceVersionId?: string | null;
  status?: "anonymous" | "authenticated";
  strict?: boolean;
} = {}) {
  const tree = (
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={
          status === "anonymous"
            ? { status: "anonymous" }
            : {
                status: "authenticated",
                user: {
                  id: actorId,
                  display_name: "Member",
                  handle: "member",
                },
              }
        }
      >
        <RecipeDraftStarter sourceVersionId={sourceVersionId} />
      </AuthSessionProvider>
    </NavigationBlockerProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function unknownCreationError() {
  return new RecipeDraftApiError(
    "Recipe Lab could not start this private draft. Try again to recover the same draft.",
    0,
    "network_error",
    [],
    "unknown",
  );
}

function terminalCreationConflict() {
  return new RecipeDraftApiError(
    "Recipe Lab could not safely match this draft attempt. Try again to start a new private draft.",
    409,
    "idempotency_key_conflict",
    [],
    "rejected",
  );
}

describe("RecipeDraftStarter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.createRecipeDraft.mockReset();
    mocks.replace.mockReset();
    window.sessionStorage.clear();
  });

  it("keeps auto-creation unmounted until a member session is ready", () => {
    renderStarter({ status: "anonymous" });

    expect(
      screen.getByRole("heading", {
        name: "Sign in to work on private recipes",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${SOURCE_ID}%2Ffork`,
    );
    expect(mocks.createRecipeDraft).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("preserves the blank-draft auth return without creating early", () => {
    renderStarter({ sourceVersionId: null, status: "anonymous" });

    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Fnew",
    );
    expect(mocks.createRecipeDraft).not.toHaveBeenCalled();
  });

  it("immediately creates and opens an exact-source private draft", async () => {
    const storageKey = seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockResolvedValue({ id: DRAFT_ID });

    renderStarter();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Copying this recipe into a private workspace",
    );
    expect(screen.queryByRole("button", { name: /create|start writing/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cancel" })).toBeNull();
    await waitFor(() =>
      expect(mocks.createRecipeDraft).toHaveBeenCalledWith(
        SOURCE_ID,
        FORK_ATTEMPT_ID,
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      `/account/recipe-drafts/${DRAFT_ID}`,
    );
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("immediately creates a distinct blank draft intent", async () => {
    seedAttempt("member-a", null, BLANK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockResolvedValue({ id: DRAFT_ID });

    renderStarter({ sourceVersionId: null });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Preparing a private workspace",
    );
    await waitFor(() =>
      expect(mocks.createRecipeDraft).toHaveBeenCalledWith(
        null,
        BLANK_ATTEMPT_ID,
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      `/account/recipe-drafts/${DRAFT_ID}`,
    );
  });

  it("does not dispatch twice during a Strict Mode effect replay", async () => {
    seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockImplementation(() => new Promise(() => undefined));

    renderStarter({ strict: true });

    await waitFor(() => expect(mocks.createRecipeDraft).toHaveBeenCalledOnce());
    expect(mocks.createRecipeDraft).toHaveBeenCalledWith(
      SOURCE_ID,
      FORK_ATTEMPT_ID,
    );
  });

  it("reuses the same attempt after an unknown outcome and keyboard-reachable retry", async () => {
    const storageKey = seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft
      .mockRejectedValueOnce(unknownCreationError())
      .mockResolvedValueOnce({ id: DRAFT_ID });

    renderStarter();

    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(retry).toHaveFocus());
    expect(retry).toHaveAttribute("type", "button");
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.createRecipeDraft.mock.calls).toEqual([
      [SOURCE_ID, FORK_ATTEMPT_ID],
      [SOURCE_ID, FORK_ATTEMPT_ID],
    ]);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(
      `/account/recipe-drafts/${DRAFT_ID}`,
    );
  });

  it("retires a terminal binding and opens one new private draft", async () => {
    const storageKey = seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(OTHER_ATTEMPT_ID);
    mocks.createRecipeDraft
      .mockRejectedValueOnce(terminalCreationConflict())
      .mockResolvedValueOnce({ id: DRAFT_ID });

    renderStarter();

    await waitFor(() => expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.createRecipeDraft.mock.calls).toEqual([
      [SOURCE_ID, FORK_ATTEMPT_ID],
      [SOURCE_ID, OTHER_ATTEMPT_ID],
    ]);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith(
      `/account/recipe-drafts/${DRAFT_ID}`,
    );
  });

  it("keeps actor, blank, and each exact-source intent isolated", async () => {
    seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    seedAttempt("member-a", null, BLANK_ATTEMPT_ID);
    seedAttempt("member-a", OTHER_SOURCE_ID, OTHER_ATTEMPT_ID);
    seedAttempt("member-b", SOURCE_ID, OTHER_ACTOR_ATTEMPT_ID);
    mocks.createRecipeDraft.mockRejectedValue(unknownCreationError());

    const first = renderStarter();
    await screen.findByRole("button", { name: "Try again" });
    first.unmount();
    const blank = renderStarter({ sourceVersionId: null });
    await screen.findByRole("button", { name: "Try again" });
    blank.unmount();
    const otherSource = renderStarter({ sourceVersionId: OTHER_SOURCE_ID });
    await screen.findByRole("button", { name: "Try again" });
    otherSource.unmount();
    renderStarter({ actorId: "member-b" });
    await screen.findByRole("button", { name: "Try again" });

    expect(mocks.createRecipeDraft.mock.calls).toEqual([
      [SOURCE_ID, FORK_ATTEMPT_ID],
      [null, BLANK_ATTEMPT_ID],
      [OTHER_SOURCE_ID, OTHER_ATTEMPT_ID],
      [SOURCE_ID, OTHER_ACTOR_ATTEMPT_ID],
    ]);
  });

  it("survives an auth interruption and reuses only the same member attempt on return", async () => {
    const storageKey = seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "Your session expired. Sign in again, then try again to recover the same private draft.",
        401,
        "authentication_required",
        [],
        "rejected",
        "sign_in",
      ),
    );

    const interrupted = renderStarter();
    await screen.findByRole("button", { name: "Try again" });
    interrupted.unmount();

    const signedOut = renderStarter({ status: "anonymous" });
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toBeVisible();
    expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
    signedOut.unmount();

    renderStarter();
    await waitFor(() => expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.createRecipeDraft.mock.calls).toEqual([
      [SOURCE_ID, FORK_ATTEMPT_ID],
      [SOURCE_ID, FORK_ATTEMPT_ID],
    ]);
  });

  it("does not clear or navigate until a valid draft ID is known", async () => {
    const storageKey = seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockResolvedValue({ id: "not-a-draft-id" });

    renderStarter();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not confirm the private draft",
    );
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses compact phone-safe landmark and card markup for the retry state", async () => {
    seedAttempt("member-a", SOURCE_ID, FORK_ATTEMPT_ID);
    mocks.createRecipeDraft.mockRejectedValue(unknownCreationError());

    const { container } = renderStarter();

    await screen.findByRole("button", { name: "Try again" });
    expect(container.querySelector("main.auth-page")).not.toBeNull();
    expect(container.querySelector("section.auth-card")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByText(/private by default/i)).toBeVisible();
  });
});
