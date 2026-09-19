import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "./auth-session-provider";
import { SignInAccess } from "./sign-in-access";
import { deferred } from "../../tests/support/deferred";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const availability = {
  enabled: true, generation_id: "f80a52ee-02ac-479e-a8db-848a2b093638",
  expires_at: "2026-09-17T12:00:00Z", contact_url: "mailto:me@peterbucci.com",
};
const guest = { status: "authenticated", temporary: true, expires_at: availability.expires_at,
  user: { id: "visitor", handle: "demo-visitor", display_name: "Demo visitor" } };

beforeEach(() => {
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, callback: () => unknown) => callback() } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function show() {
  return render(
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      <SignInAccess artwork={<div aria-hidden="true" />} returnTo="/recipes/new" />
    </AuthSessionProvider>,
  );
}

describe("sandbox entry", () => {
  it("shows expiry and privacy notice, then enters the real member workflow", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(availability))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", request);
    show();
    const entry = await screen.findByRole("button", { name: "Start the demo" });
    expect(screen.getByRole("heading", { name: "Try Recipe Lab" })).toBeVisible();
    expect(screen.getByText("Explore Recipe Lab for yourself.")).toBeVisible();
    expect(screen.getByText(/please don’t include personal or sensitive information/)).toBeVisible();
    expect(screen.queryByText(/No uploads/)).toBeNull();
    expect(screen.getByRole("link", { name: "Contact me@peterbucci.com" }))
      .toHaveAttribute("href", "mailto:me@peterbucci.com");
    expect(screen.getByText(/Thu, Sep 17 at 12:00 PM GMT/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Continue to sign in" })).toBeNull();
    fireEvent.click(entry);
    await screen.findByRole("button", { name: "Continue to the app" });
    expect(screen.queryByRole("heading", { name: "Sign in to Recipe Lab" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Keep browsing" })).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith("/recipes/new");
    const [url, init] = request.mock.calls[2];
    expect(url).toBe("/api/auth/demo");
    const payload = JSON.parse(init.body);
    expect(payload.generation_id).toBe(availability.generation_id);
    expect(payload.entry_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("preserves an already active identity without issuing a new one", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(availability)).mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", request);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Start the demo" }));
    await screen.findByRole("button", { name: "Continue to the app" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps failure retryable without falling back to a nonexistent identity provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(availability))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockResolvedValueOnce(Response.json({ error: { code: "demo_generation_changed", issues: [] } }, { status: 409 })));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Start the demo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Reload the page to start fresh/);
    expect(screen.getByRole("button", { name: "Start the demo" })).toBeEnabled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("does not navigate when a delayed entry completes after leaving the page", async () => {
    const entry = deferred<Response>();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(availability))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockImplementationOnce((_url, init) => { signal = init.signal; return entry.promise; }));
    const view = show();
    fireEvent.click(await screen.findByRole("button", { name: "Start the demo" }));
    await screen.findByRole("button", { name: "Starting demo…" });
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => entry.resolve(Response.json(guest)));
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
