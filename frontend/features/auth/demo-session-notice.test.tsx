import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthSessionProvider } from "./auth-session-provider";
import { DemoSessionNotice } from "./demo-session-notice";

describe("DemoSessionNotice", () => {
  it("links a temporary member to the authenticated details route", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          temporary: true,
          expires_at: "2026-09-20T19:42:37Z",
          user: {
            id: "demo-id",
            display_name: "Demo cook",
            handle: "demo-cook",
          },
        }}
      >
        <DemoSessionNotice />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("link", { name: "View details" }),
    ).toHaveAttribute("href", "/account/demo");
    expect(screen.getByLabelText("Demo account notice")).toHaveTextContent(
      "Demo account · Published work is public · Don’t enter personal or sensitive information · Resets by Sun, Sep 20 at 7:42 PM GMT · View details",
    );
    expect(screen.getByText("Sun, Sep 20 at 7:42 PM GMT")).toHaveAttribute(
      "datetime",
      "2026-09-20T19:42:37Z",
    );
  });

  it("does not appear for an anonymous visitor", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <DemoSessionNotice />
      </AuthSessionProvider>,
    );

    expect(screen.queryByLabelText("Demo account notice")).toBeNull();
  });
});
