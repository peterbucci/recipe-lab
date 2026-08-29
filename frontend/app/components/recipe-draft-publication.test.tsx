import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../../lib/auth-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  createStructuredActionDraft,
  type RecipeDraftEditorState,
  type RecipeDraftValidation,
} from "../../lib/recipe-draft";
import { RecipeDuplicateApiError } from "../../lib/recipe-duplicate-api";
import { RecipePublicationApiError } from "../../lib/recipe-publication-api";
import { createUnspecifiedMeasureDraft } from "../../lib/structured-measure";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftPublication } from "./recipe-draft-publication";

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  publish: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  key: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.key,
}));

vi.mock("../../lib/recipe-duplicate-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-duplicate-api")>();
  return { ...actual, createRecipeDraftDuplicatePreflight: mocks.preflight };
});

vi.mock("../../lib/recipe-publication-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-publication-api")>();
  return { ...actual, publishRecipeDraft: mocks.publish };
});

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const PREFLIGHT_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const INGREDIENT_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
const actionType: CatalogActionType = {
  id: "55555555-5555-4555-8555-555555555555",
  key: "mix",
  canonical_verb: "mix",
  active: true,
  provenance: "Test catalog.",
};

function completeDraft(): RecipeDraftEditorState {
  const ingredient = createDraftIngredientState("ingredient-ref");
  ingredient.selection = {
    kind: "catalog",
    ingredient: {
      ingredientId: INGREDIENT_ID,
      canonicalName: "sage",
      displayName: "Sage",
    },
  };
  ingredient.measure = createUnspecifiedMeasureDraft();
  const instruction = createDraftInstructionState("instruction-ref");
  instruction.text = "Mix the sage.";
  const action = createStructuredActionDraft("action-ref");
  action.actionType = actionType;
  action.ingredientKeys = [ingredient.key];
  instruction.actions = [action];
  return {
    title: "Sage recipe",
    description: "A complete original.",
    servings: "2",
    ingredients: [ingredient],
    instructions: [instruction],
  };
}

function probablePreflight() {
  return {
    classification: "probable_duplicate" as const,
    same_lineage_no_change: false,
    candidates: [{
      public_recipe_version_id: RECIPE_ID,
      title: "Public sage recipe",
      classification: "probable_duplicate" as const,
      score: "0.875000",
      reasons: [{ code: "matching_structure", message: "The structures are similar." }],
    }],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "a".repeat(64),
      required: true,
      allowed_decisions: ["continue" as const, "revise" as const],
    },
  };
}

function directParentNoChangePreflight() {
  return {
    classification: "exact_duplicate" as const,
    same_lineage_no_change: true,
    candidates: [],
    warnings: [{
      code: "same_lineage_no_change" as const,
      message: "This version has the same canonical structure as its direct parent.",
    }],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "b".repeat(64),
      required: true,
      allowed_decisions: ["continue" as const, "revise" as const],
    },
  };
}

function renderPublication({
  dirty = false,
  draft = completeDraft(),
  onValidation = vi.fn(),
  sourceVersionId = null,
}: {
  dirty?: boolean;
  draft?: RecipeDraftEditorState;
  onValidation?: (validation: RecipeDraftValidation) => void;
  sourceVersionId?: string | null;
} = {}) {
  return render(
    <NavigationBlockerProvider>
      <RecipeDraftPublication
        actionTypes={[actionType]}
        draft={draft}
        draftId={DRAFT_ID}
        dirty={dirty}
        measurementUnits={[]}
        onBusyChange={vi.fn()}
        onValidation={onValidation}
        revision={4}
        sourceVersionId={sourceVersionId}
      />
    </NavigationBlockerProvider>,
  );
}

function distinctPreflight() {
  return {
    classification: "distinct" as const,
    same_lineage_no_change: false,
    candidates: [],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "c".repeat(64),
      required: false,
      allowed_decisions: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function confirmPublication() {
  fireEvent.click(screen.getAllByRole("checkbox", { name: /agree to the community rules/i }).at(-1)!);
  fireEvent.click(screen.getAllByRole("checkbox", { name: /right to share it/i }).at(-1)!);
}

describe("RecipeDraftPublication", () => {
  beforeEach(() => {
    mocks.preflight.mockReset();
    mocks.publish.mockReset();
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
    mocks.key.mockReset().mockReturnValueOnce("preflight-key").mockReturnValueOnce("publish-key");
  });

  it("requires a confirmed save and publication-complete fields before review", async () => {
    const dirtyPublication = renderPublication({ dirty: true });
    expect(screen.getByRole("button", { name: "Review and publish" })).toBeDisabled();
    expect(screen.getByText("Save your latest changes before publishing.")).toBeVisible();
    expect(screen.getByText(/published recipes and their recipe history stay public/i)).toHaveTextContent(
      /Deleted cook.*withdraw/i,
    );
    dirtyPublication.unmount();

    const onValidation = vi.fn();
    renderPublication({
      draft: { title: "", description: "", servings: "", ingredients: [], instructions: [] },
      onValidation,
    });
    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    expect(onValidation).toHaveBeenCalledWith(expect.objectContaining({ payload: null }));
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("pauses on a probable match and publishes only after explicit acknowledgement", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication();

    expect(screen.getByRole("link", { name: "Return to your private drafts" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm the community rules/i);
    expect(mocks.preflight).not.toHaveBeenCalled();
    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledWith(DRAFT_ID, 4, "preflight-key"));
    const continueButton = await screen.findByRole("button", { name: "Publish recipe anyway" });
    expect(continueButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /publish my recipe anyway/i }));
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(
      DRAFT_ID,
      {
        revision: 4,
        community_rules_accepted: true,
        content_rights_confirmed: true,
        duplicate_review: {
          preflight_id: PREFLIGHT_ID,
          policy_version: "recipe-duplicate-preflight-policy-v1",
          result_digest: "a".repeat(64),
          decision: "continue",
        },
      },
      "publish-key",
    ));
    expect(mocks.replace).toHaveBeenCalledWith("/account/recipes?view=published");
    expect(screen.getByText("Recipe published. Opening your published recipes…")).toHaveAttribute(
      "role",
      "status",
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("publishes a distinct recipe without showing an empty similarity review", async () => {
    mocks.preflight.mockResolvedValue(distinctPreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(screen.queryByRole("region", { name: /similar recipes/i })).toBeNull();
    expect(mocks.publish).toHaveBeenCalledWith(
      DRAFT_ID,
      expect.objectContaining({
        duplicate_review: expect.objectContaining({ decision: null }),
      }),
      "publish-key",
    );
    expect(mocks.replace).toHaveBeenCalledWith("/account/recipes?view=published");
  });

  it("does not auto-publish when confirmation is revoked during a pending preflight", async () => {
    const preflight = deferred<ReturnType<typeof distinctPreflight>>();
    mocks.preflight.mockReturnValue(preflight.promise);
    renderPublication();

    confirmPublication();
    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledOnce());
    fireEvent.click(communityRules);

    await act(async () => {
      preflight.resolve(distinctPreflight());
      await preflight.promise;
    });

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(communityRules).not.toBeChecked();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm the community rules/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      /publishing paused.*your draft is still here/i,
    );
    expect(screen.getByRole("button", { name: "Review and publish" })).toBeEnabled();
  });

  it("pauses a retried preflight when confirmation is revoked while it is pending", async () => {
    const retryPreflight = deferred<ReturnType<typeof distinctPreflight>>();
    mocks.preflight
      .mockRejectedValueOnce(
        new RecipeDuplicateApiError(
          "Recipe Lab could not check this recipe right now.",
          503,
          "duplicate_preflight_unavailable",
        ),
      )
      .mockReturnValueOnce(retryPreflight.promise);
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const retry = await screen.findByRole("button", { name: "Check similar recipes again" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledTimes(2));

    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(communityRules);
    await act(async () => {
      retryPreflight.resolve(distinctPreflight());
      await retryPreflight.promise;
    });

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review and publish" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /publishing paused.*your draft is still here/i,
    );
  });

  it("does not continue a duplicate publication after confirmation is revoked", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    const contentRights = screen
      .getAllByRole("checkbox", { name: /right to share it/i })
      .at(-1)!;
    fireEvent.click(contentRights);
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));

    await waitFor(() => expect(contentRights).toHaveFocus());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/confirm the community rules/i);
    expect(screen.getByRole("checkbox", { name: /publish my recipe anyway/i })).toBeChecked();
  });

  it("does not retry publication after confirmation is revoked", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish
      .mockRejectedValueOnce(
        new RecipePublicationApiError(
          "Canonical occurrence 99999999-9999-4999-8999-999999999999 failed publication.",
          503,
          "recipe_publication_unavailable",
        ),
      )
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));
    const retry = await screen.findByRole("button", { name: "Try publishing again" });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Recipe Lab could not publish this recipe. Your saved draft is still here.",
    );
    expect(screen.queryByText(/canonical|occurrence|99999999/i)).toBeNull();

    const communityRules = screen
      .getAllByRole("checkbox", { name: /agree to the community rules/i })
      .at(-1)!;
    fireEvent.click(communityRules);
    fireEvent.click(retry);

    await waitFor(() => expect(communityRules).toHaveFocus());
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(screen.getByText(/confirm the community rules and your right to share/i)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /publish my recipe anyway/i })).toBeChecked();

    fireEvent.click(communityRules);
    fireEvent.click(screen.getByRole("button", { name: "Try publishing again" }));
    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        community_rules_accepted: true,
        content_rights_confirmed: true,
      }),
    );
  });

  it("explains that publication waits for an unavailable similarity check and only offers retry", async () => {
    mocks.preflight.mockRejectedValue(
      new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
        "duplicate_preflight_unavailable",
      ),
    );
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const retry = await screen.findByRole("button", { name: "Check similar recipes again" });
    expect(screen.getByRole("alert")).toHaveTextContent(/similar-recipes check unavailable/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/publishing waits/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/saved draft.*still/i);
    expect(screen.queryByRole("button", { name: /publish without/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review and publish" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Publish this original recipe." })).toBeVisible();

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledTimes(2));
    expect(mocks.preflight.mock.calls.map((call) => call[2])).toEqual([
      "preflight-key",
      "preflight-key",
    ]);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous reviewed publication with the same publication key", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish
      .mockRejectedValueOnce(
        new RecipePublicationApiError(
          "Recipe Lab could not confirm the publication receipt.",
          502,
          "invalid_recipe_publication_response",
        ),
      )
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));

    const retry = await screen.findByRole("button", { name: "Check publication result" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /may already be published/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot create a second publication/i);
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.publish.mock.calls.map((call) => call[2])).toEqual([
      "publish-key",
      "publish-key",
    ]);
    expect(mocks.replace).toHaveBeenCalledWith("/account/recipes?view=published");
  });

  it("keeps duplicate acknowledgement visible while publication is pending", async () => {
    const publication = deferred<{ recipe_version_id: string; location: string }>();
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockReturnValue(publication.promise);
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    const acknowledgement = await screen.findByRole("checkbox", {
      name: /publish my recipe anyway/i,
    });
    fireEvent.click(acknowledgement);
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledOnce());
    expect(acknowledgement).toBeChecked();

    await act(async () => {
      publication.resolve({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
      await publication.promise;
    });
  });

  it("checks a lost distinct publication result directly with the same publication key", async () => {
    mocks.preflight.mockResolvedValue(distinctPreflight());
    mocks.publish
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        location: `/recipes/${RECIPE_ID}`,
      });
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    const retry = await screen.findByRole("button", { name: "Check publication result" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /may already be published/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot create a second publication/i);
    expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review and publish" })).toBeNull();
    fireEvent.click(retry);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.publish.mock.calls.map((call) => call[2])).toEqual([
      "publish-key",
      "publish-key",
    ]);
  });

  it("classifies a pre-request authentication interruption and keeps review context", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockRejectedValue(
      new AuthApiError("Your session expired. Sign in again to continue.", 401, "csrf_token_unavailable"),
    );
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Your draft is still here; sign in again before continuing.",
    );
    expect(screen.getByRole("link", { name: "Sign in again in a new tab" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Faccount%2Frecipe-drafts%2F${DRAFT_ID}`,
    );
    expect(screen.getByRole("button", { name: "Try publishing again" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Review similar recipes" })).toBeVisible();
  });

  it("classifies a revision conflict and directs the author to the latest saved draft", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockRejectedValue(
      new RecipePublicationApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
    renderPublication();

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /publish my recipe anyway/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish recipe anyway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This draft changed in another tab. Open the latest saved draft before publishing.",
    );
    expect(
      screen.getByRole("link", { name: "Open latest draft in a new tab" }),
    ).toHaveAttribute("href", `/account/recipe-drafts/${DRAFT_ID}`);
    expect(
      screen.getByRole("link", { name: "Open latest draft in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("button", { name: "Check similar recipes again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review and publish" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Review similar recipes" })).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("requires an explicit unchanged-version decision before publishing a version", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication({ sourceVersionId: SOURCE_ID });

    expect(
      screen.getByRole("heading", { name: "Publish your version without changing its source." }),
    ).toBeVisible();
    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish version" }));

    const acknowledgement = await screen.findByRole("checkbox", {
      name: /matches the recipe it is based on/i,
    });
    expect(screen.getByText("Your version matches the recipe it is based on.")).toBeVisible();
    expect(screen.queryByText(/direct parent|canonical|immutable/i)).toBeNull();
    const publishAnyway = screen.getByRole("button", { name: "Publish version anyway" });
    expect(publishAnyway).toBeDisabled();
    fireEvent.click(acknowledgement);
    fireEvent.click(publishAnyway);

    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith(
        DRAFT_ID,
        {
          revision: 4,
          community_rules_accepted: true,
          content_rights_confirmed: true,
          duplicate_review: {
            preflight_id: PREFLIGHT_ID,
            policy_version: "recipe-duplicate-preflight-policy-v1",
            result_digest: "b".repeat(64),
            decision: "continue",
          },
        },
        "publish-key",
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/account/recipes?view=published");
  });

  it("keeps a fork draft in place when its source becomes unavailable", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockRejectedValue(
      new RecipePublicationApiError(
        "The public source recipe is no longer available. Your private draft is unchanged.",
        409,
        "recipe_fork_source_unavailable",
      ),
    );
    renderPublication({ sourceVersionId: SOURCE_ID });

    confirmPublication();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish version" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /matches the recipe it is based on/i }));
    fireEvent.click(screen.getByRole("button", { name: "Publish version anyway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The recipe this version is based on is no longer available. Your private draft is unchanged.",
    );
    expect(screen.getByRole("button", { name: "Check source and retry" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Check source page" })).toHaveAttribute(
      "href",
      `/recipes/${SOURCE_ID}`,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Publish your version without changing its source." })).toBeVisible();
  });
});
