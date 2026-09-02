import type { MemberIngredientRequest } from "./ingredient-catalog-api";
import type { MyRecipeLibraryPage, SavedRecipeLibraryPage } from "./recipe-library-api";

export type MemberActivityKind =
  | "draft"
  | "ingredient-request"
  | "published"
  | "saved"
  | "withdrawn";

export interface MemberActivity {
  detail?: string;
  href: string;
  id: string;
  kind: MemberActivityKind;
  label: string;
  timestamp: string;
  title: string;
}

export interface MemberActivitySources {
  drafts?: Pick<MyRecipeLibraryPage, "items">;
  ingredientRequests?: { items: MemberIngredientRequest[] };
  published?: Pick<MyRecipeLibraryPage, "items">;
  saved?: Pick<SavedRecipeLibraryPage, "items">;
  withdrawn?: Pick<MyRecipeLibraryPage, "items">;
}

function timestampValue(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function requestActivityLabel(status: string): string {
  if (status === "approved") return "Ingredient request approved";
  if (status === "duplicate") return "Ingredient request matched";
  if (status === "rejected") return "Ingredient request rejected";
  return "Ingredient request reviewed";
}

function requestActivityDetail(status: string): string {
  if (status === "approved") {
    return "The ingredient is now available in the catalog.";
  }
  if (status === "duplicate") {
    return "A matching ingredient is already available in the catalog.";
  }
  return "A curator reviewed this request.";
}

export function buildMemberActivities({
  drafts,
  ingredientRequests,
  published,
  saved,
  withdrawn,
}: MemberActivitySources): MemberActivity[] {
  const activities: MemberActivity[] = [];

  for (const item of drafts?.items ?? []) {
    if (item.kind !== "draft") continue;
    activities.push({
      href: `/recipes/drafts/${item.draft.id}`,
      id: `draft:${item.draft.id}`,
      kind: "draft",
      label: "Updated draft",
      timestamp: item.draft.updated_at,
      title: item.draft.title.trim() || "Untitled recipe",
    });
  }

  for (const item of published?.items ?? []) {
    if (item.kind !== "published") continue;
    activities.push({
      detail:
        item.visibility_state === "moderation_hidden"
          ? "Currently hidden by moderation"
          : undefined,
      href: "/account/recipes?view=published",
      id: `published:${item.recipe.id}`,
      kind: "published",
      label: "Published recipe version",
      timestamp: item.recipe.published_at,
      title: item.recipe.title,
    });
  }

  for (const item of withdrawn?.items ?? []) {
    if (item.kind !== "published") continue;
    activities.push({
      detail: "This recipe is no longer publicly available.",
      href: "/account/recipes?view=withdrawn",
      id: `withdrawn:${item.recipe.id}`,
      kind: "withdrawn",
      label: "Published recipe version",
      timestamp: item.recipe.published_at,
      title: item.recipe.title,
    });
  }

  for (const item of saved?.items ?? []) {
    activities.push({
      href: "/account/recipes?view=saved",
      id: `saved:${item.recipe.id}`,
      kind: "saved",
      label: "Saved recipe",
      timestamp: item.saved_at,
      title: item.recipe.title,
    });
  }

  for (const item of ingredientRequests?.items ?? []) {
    if (item.reviewed_at === null) continue;
    activities.push({
      detail: requestActivityDetail(item.status),
      href: "/account/ingredient-requests",
      id: `ingredient-request:${item.id}`,
      kind: "ingredient-request",
      label: requestActivityLabel(item.status),
      timestamp: item.reviewed_at,
      title: item.proposed_name,
    });
  }

  return activities
    .filter((activity) => Number.isFinite(Date.parse(activity.timestamp)))
    .sort((left, right) => {
      const byTime = timestampValue(right.timestamp) - timestampValue(left.timestamp);
      return byTime || left.id.localeCompare(right.id);
    });
}
