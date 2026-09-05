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
        new RecipeReportApiError(
          "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
          503,
        ),
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not confirm whether your report was received",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "safely check the same report",
    );
    expect(screen.queryByText(/99999999|canonical|uuid|operator|policy/i)).toBeNull();
    expect(screen.getByLabelText("Additional details (optional)")).toHaveValue(
      "Repeated affiliate links",
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Report received"));
    expect(mocks.key).toHaveBeenCalledOnce();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
  });

  it("rotates the protected attempt only when normalized intent changes", async () => {
    mocks.key
      .mockReset()
      .mockReturnValueOnce("report-key-one")
      .mockReturnValueOnce("report-key-two");
    mocks.submit.mockRejectedValue(
      new RecipeReportApiError(
        "The result is unknown.",
        503,
        "report_service_unavailable",
      ),
    );
    render(<RecipeReportPanel recipeVersionId={RECIPE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
    fireEvent.click(screen.getByRole("radio", { name: "Spam or misleading content" }));
    const details = screen.getByLabelText("Additional details (optional)");
    expect(details.parentElement).toHaveClass("recipe-form-field");
    fireEvent.change(details, { target: { value: "  Repeated affiliate links  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    await screen.findByRole("alert");

    fireEvent.change(details, { target: { value: "Repeated affiliate links" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[0]?.[2]).toBe("report-key-one");
    expect(mocks.submit.mock.calls[1]?.[2]).toBe("report-key-one");

    fireEvent.click(screen.getByRole("radio", { name: "Something else" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2]?.[2]).toBe("report-key-two");
    expect(mocks.key).toHaveBeenCalledTimes(2);
  });

  it("treats an existing report as a successful private review", async () => {
    mocks.submit.mockRejectedValue(
      new RecipeReportApiError(
        "You already reported this recipe.",
        409,
        "recipe_already_reported",
      ),
    );
    render(<RecipeReportPanel recipeVersionId={RECIPE_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Report recipe" }));
    fireEvent.click(screen.getByRole("radio", { name: "Spam or misleading content" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit private report" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "existing report is still in review",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
