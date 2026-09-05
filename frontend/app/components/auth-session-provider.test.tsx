import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  fetchAuthSession,
  type AuthSession,
} from "../../lib/auth-api";
import { deferred } from "../../tests/support/deferred";
import {
  AuthSessionProvider,
  SessionRecoveryNotice,
  useAuthSession,
} from "./auth-session-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/settings",
}));

vi.mock("../../lib/auth-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/auth-api")>();
  return { ...actual, fetchAuthSession: vi.fn() };
});

const alice = {
  status: "authenticated",
  user: { id: "alice-id", display_name: "Alice Cook", handle: "alice" },
} satisfies AuthSession;

const bob = {
  status: "authenticated",
  user: { id: "bob-id", display_name: "Bob Cook", handle: "bob" },
} satisfies AuthSession;

const fetchAuthSessionMock = vi.mocked(fetchAuthSession);

function SessionProbe() {
  const { refreshSession, replaceSession, sessionExpired, state } = useAuthSession();
  const stateLabel =
    state.phase === "ready"
      ? state.session.status === "authenticated"
        ? `ready:${state.session.user.id}`
        : `ready:${state.session.status}`
      : state.phase;

  return (
    <>
      <output data-testid="session-state">{stateLabel}</output>
      <output data-testid="session-expired">{String(sessionExpired)}</output>
      <button type="button" onClick={() => void refreshSession()}>
        Refresh
      </button>
      <button type="button" onClick={() => replaceSession(bob)}>
        Replace
      </button>
    </>
  );
}

beforeEach(() => {
  fetchAuthSessionMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthSessionProvider", () => {
  it("loads the initial session", async () => {
    fetchAuthSessionMock.mockResolvedValueOnce(alice);

    render(
      <AuthSessionProvider>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    expect(screen.getByTestId("session-state")).toHaveTextContent("loading");
    expect(await screen.findByTestId("session-state")).toHaveTextContent(
      "ready:alice-id",
    );
  });

  it("exposes an error state when the initial session cannot load", async () => {
    fetchAuthSessionMock.mockRejectedValueOnce(new Error("network unavailable"));

    render(
      <AuthSessionProvider>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-state")).toHaveTextContent("error");
    });
  });

  it("aborts the initial request when it unmounts", () => {
    let requestSignal: AbortSignal | undefined;
    fetchAuthSessionMock.mockImplementationOnce((signal) => {
      requestSignal = signal;
      return new Promise<AuthSession>(() => undefined);
    });

    const { unmount } = render(
      <AuthSessionProvider>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    expect(requestSignal?.aborted).toBe(false);
    unmount();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("lets the newest overlapping refresh win", async () => {
    const first = deferred<AuthSession>();
    const second = deferred<AuthSession>();
    fetchAuthSessionMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await act(async () => second.resolve(alice));
    expect(screen.getByTestId("session-state")).toHaveTextContent("ready:alice-id");

    await act(async () => first.resolve(bob));
    expect(screen.getByTestId("session-state")).toHaveTextContent("ready:alice-id");
  });

  it("does not let a pending refresh overwrite an explicitly replaced session", async () => {
    const pending = deferred<AuthSession>();
    fetchAuthSessionMock.mockImplementationOnce(() => pending.promise);

    render(
      <AuthSessionProvider initialSession={alice}>
        <SessionProbe />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByTestId("session-state")).toHaveTextContent("ready:bob-id");

    await act(async () => pending.resolve(alice));
    expect(screen.getByTestId("session-state")).toHaveTextContent("ready:bob-id");
  });

  it("recovers after focus and removes its window listeners on unmount", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    fetchAuthSessionMock.mockResolvedValueOnce(alice);

    const { unmount } = render(
      <AuthSessionProvider initialSession={alice}>
        <SessionRecoveryNotice />
      </AuthSessionProvider>,
    );

    act(() => window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT)));
    fireEvent.click(screen.getByRole("link", { name: "Sign in in a new tab" }));

    const expiredListener = addEventListener.mock.calls.find(
      ([type]) => type === AUTH_SESSION_EXPIRED_EVENT,
    )?.[1];
    const focusListener = addEventListener.mock.calls.find(
      ([type]) => type === "focus",
    )?.[1];
    expect(expiredListener).toBeDefined();
    expect(focusListener).toBeDefined();

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      AUTH_SESSION_EXPIRED_EVENT,
      expiredListener,
    );
    expect(removeEventListener).toHaveBeenCalledWith("focus", focusListener);
  });

  it("rejects use outside its provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(<SessionProbe />)).toThrow(
      "useAuthSession must be used inside AuthSessionProvider.",
    );
  });
});
