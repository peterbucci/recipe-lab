import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import { AuthSessionProvider } from "./auth-session-provider";
import {
  StaffWorkspaceAccess,
  StaffWorkspaceShell,
  StaffWorkspaceSplitPanel,
} from "./staff-workspace-shell";

function staffSession(canReview: boolean): AuthSession {
  return {
    status: "authenticated",
    user: { id: "staff-id", display_name: "Sam Staff", handle: "sam" },
    capabilities: {
      review_ingredient_requests: canReview,
      moderate_recipe_reports: false,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StaffWorkspaceAccess", () => {
  it("uses the shared loading surface while capabilities resolve", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(
      <AuthSessionProvider>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
          loadingLabel="Checking review access…"
          variant="curation"
        >
          {() => <p>Private review tools</p>}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page--curation",
      "staff-state-page--loading",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checking review access…");
    expect(screen.queryByText("Private review tools")).not.toBeInTheDocument();
  });

  it("does not render protected slots without the required capability", () => {
    render(
      <AuthSessionProvider initialSession={staffSession(false)}>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
          loadingLabel="Checking review access…"
          variant="curation"
        >
          {() => <p>Private review tools</p>}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page--curation",
      "staff-state-page--authorization",
    );
    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByText("Private review tools")).not.toBeInTheDocument();
  });

  it("rechecks the account and hides protected slots after authorization is lost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(staffSession(false)), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthSessionProvider initialSession={staffSession(true)}>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
          loadingLabel="Checking review access…"
          variant="curation"
        >
          {(onAuthorizationLost) => (
            <button type="button" onClick={onAuthorizationLost}>
              Simulate authorization loss
            </button>
          )}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Simulate authorization loss" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Simulate authorization loss" }),
    ).not.toBeInTheDocument();
  });
});

describe("StaffWorkspaceShell", () => {
  it("owns the shared page, header, and queue-detail structure", () => {
    render(
      <StaffWorkspaceShell
        className="curation-page"
        description="Review incoming requests."
        headerClassName="curation-page__intro"
        title="Ingredient requests"
        variant="curation"
      >
        <StaffWorkspaceSplitPanel
          className="curation-workspace"
          detailClassName="curation-detail"
          detailHeadingId="request-detail"
          queue={<section aria-label="Request queue">Queue</section>}
        >
          <h2 id="request-detail">Request detail</h2>
        </StaffWorkspaceSplitPanel>
      </StaffWorkspaceShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveClass("staff-workspace", "staff-workspace--curation");
    expect(screen.getByRole("heading", { name: "Ingredient requests" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Request detail" })).toHaveClass(
      "staff-workspace__detail",
      "curation-detail",
    );
    expect(screen.getByRole("region", { name: "Request queue" }).parentElement).toHaveClass(
      "staff-workspace__layout",
      "curation-workspace",
    );
  });
});
