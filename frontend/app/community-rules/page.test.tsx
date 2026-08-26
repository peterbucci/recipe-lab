import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CommunityRulesPage, { metadata } from "./page";

describe("CommunityRulesPage", () => {
  it("states the publishing, safety, privacy, and enforcement boundaries", () => {
    render(<CommunityRulesPage />);

    expect(metadata.title).toBe("Community rules");
    expect(screen.getByRole("heading", { name: "Community rules", level: 1 })).toBeVisible();
    expect(screen.getByRole("heading", { name: /right to publish/i })).toBeVisible();
    expect(screen.getByRole("heading", { name: /safe and lawful/i })).toBeVisible();
    expect(screen.getByText(/reporter identities and report details are not shown/i)).toBeVisible();
    expect(screen.getByText(/confirm that you accept these rules/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /how recipe lab works/i })).toHaveAttribute(
      "href",
      "/#how-it-works",
    );
  });
});
