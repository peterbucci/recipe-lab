import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  StaffWorkspaceShell,
  StaffWorkspaceSplitPanel,
} from "./staff-workspace-shell";

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
