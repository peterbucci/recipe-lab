import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeReportApiError } from "../../lib/recipe-report-api";
import { RecipeReportPanel } from "./recipe-report-panel";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), key: vi.fn() }));

vi.mock("../../lib/idempotency-key", () => ({ createIdempotencyKey: mocks.key }));
vi.mock("../../lib/recipe-report-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-report-api")>();
  return { ...actual, submitRecipeReport: mocks.submit };
});

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.submit.mockReset();
  mocks.key.mockReset().mockReturnValue("report-key");
});

describe("RecipeReportPanel", () => {
  it("collects one fixed reason and bounded private details", async () => {
    mocks.submit.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      recipe_version_id: RECIPE_ID,
      submitted_at: "2026-08-26T12:00:00Z",
    });
    render(<RecipeReportPanel recipeVersionId={RECIPE_ID} />);

    const toggle = screen.getByRole("button", { name: "Report recipe" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/shares no reporter identity/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "community rules" })).toHaveAttribute(
      "href",
      "/community-rules",
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a reason");
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Harassment or hateful content" }));
    fireEvent.change(screen.getByLabelText("Additional details (optional)"), {
      target: { value: "  Targeted slur in the description.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith(
        RECIPE_ID,
        { reason: "harassment", details: "Targeted slur in the description." },
        "report-key",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Report received");
    expect(screen.queryByText("Targeted slur in the description.")).not.toBeInTheDocument();
  });

  it("keeps form content and the same attempt key for a safe retry", async () => {
    mocks.submit
      .mockRejectedValueOnce(
        new RecipeReportApiError("Recipe Lab could not submit this report.", 503),
      )
      .mockResolvedValueOnce({
        id: "22222222-2222-4222-8222-222222222222",
        recipe_version_id: RECIPE_ID,
        submitted_at: "2026-08-26T12:00:00Z",
      });
    render(<RecipeReportPanel recipeVersionId={RECIPE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
    fireEvent.click(screen.getByRole("radio", { name: "Spam or misleading content" }));
    fireEvent.change(screen.getByLabelText("Additional details (optional)"), {
      target: { value: "Repeated affiliate links" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not submit");
    expect(screen.getByLabelText("Additional details (optional)")).toHaveValue(
      "Repeated affiliate links",
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Report received"));
    expect(mocks.key).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
});
