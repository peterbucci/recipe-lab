import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import { AccountConnectionsRoute } from "./account-connections-route";

const mocks = vi.hoisted(() => ({ workspace: vi.fn() }));

vi.mock(
  "../../../../features/community/member-connections-workspace",
  () => ({
    MemberConnectionsWorkspace: (props: {
      pageNumber: number;
      userId: string;
      view: "followers" | "following";
    }) => {
      mocks.workspace(props);
      return <p>Connections workspace</p>;
    },
  }),
);

beforeEach(() => {
  mocks.workspace.mockClear();
});

describe("AccountConnectionsRoute", () => {
  it("keeps the selected Connections view behind the account session boundary", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <AccountConnectionsRoute pageNumber={2} view="following" />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Fconnections%3Fview%3Dfollowing%26page%3D2",
    );
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("preserves the selected view while account setup is incomplete", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "viewer", display_name: "Viewer", handle: null },
        }}
      >
        <AccountConnectionsRoute pageNumber={1} view="followers" />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("link", { name: "Finish account setup" }),
    ).toHaveAttribute(
      "href",
      "/onboarding?return_to=%2Faccount%2Fconnections%3Fview%3Dfollowers",
    );
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("mounts the selected workspace for the authenticated account", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "viewer", display_name: "Viewer", handle: "viewer" },
        }}
      >
        <AccountConnectionsRoute pageNumber={3} view="following" />
      </AuthSessionProvider>,
    );

    expect(screen.getByText("Connections workspace")).toBeVisible();
    expect(mocks.workspace).toHaveBeenCalledWith({
      pageNumber: 3,
      userId: "viewer",
      view: "following",
    });
  });
});
