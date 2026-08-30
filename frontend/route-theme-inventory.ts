export const RCP46_THEME_FAMILIES = [
  "account-access",
  "account-workspace",
  "discovery",
  "public-context",
  "recipe-authoring",
  "staff-curation",
  "staff-moderation",
  "system-state",
] as const;

export type Rcp46ThemeFamily = (typeof RCP46_THEME_FAMILIES)[number];

interface PageThemeInventoryItem {
  readonly file: `app/${string}/page.tsx` | "app/page.tsx";
  readonly route: string;
  readonly family: Exclude<Rcp46ThemeFamily, "system-state">;
}

interface RouteStateThemeInventoryItem {
  readonly file: `app/${string}.tsx`;
  readonly kind: "error" | "loading" | "not-found";
  readonly family: Rcp46ThemeFamily;
}

export const RCP46_PAGE_THEME_INVENTORY = [
  {
    file: "app/account/deleted/page.tsx",
    route: "/account/deleted",
    family: "account-access",
  },
  {
    file: "app/account/ingredient-requests/page.tsx",
    route: "/account/ingredient-requests",
    family: "account-workspace",
  },
  {
    file: "app/account/recipe-drafts/[draftId]/page.tsx",
    route: "/account/recipe-drafts/[draftId]",
    family: "recipe-authoring",
  },
  {
    file: "app/account/recipe-drafts/page.tsx",
    route: "/account/recipe-drafts",
    family: "account-workspace",
  },
  {
    file: "app/account/recipes/page.tsx",
    route: "/account/recipes",
    family: "account-workspace",
  },
  {
    file: "app/account/saved-recipes/page.tsx",
    route: "/account/saved-recipes",
    family: "account-workspace",
  },
  {
    file: "app/account/settings/page.tsx",
    route: "/account/settings",
    family: "account-workspace",
  },
  {
    file: "app/auth/callback/page.tsx",
    route: "/auth/callback",
    family: "account-access",
  },
  {
    file: "app/catalog/ingredient-requests/page.tsx",
    route: "/catalog/ingredient-requests",
    family: "staff-curation",
  },
  {
    file: "app/community-rules/page.tsx",
    route: "/community-rules",
    family: "public-context",
  },
  {
    file: "app/cooks/[handle]/page.tsx",
    route: "/cooks/[handle]",
    family: "public-context",
  },
  {
    file: "app/moderation/recipes/page.tsx",
    route: "/moderation/recipes",
    family: "staff-moderation",
  },
  {
    file: "app/onboarding/page.tsx",
    route: "/onboarding",
    family: "account-access",
  },
  { file: "app/page.tsx", route: "/", family: "discovery" },
  {
    file: "app/recipes/[recipeVersionId]/compare/page.tsx",
    route: "/recipes/[recipeVersionId]/compare",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/fork/page.tsx",
    route: "/recipes/[recipeVersionId]/fork",
    family: "recipe-authoring",
  },
  {
    file: "app/recipes/[recipeVersionId]/page.tsx",
    route: "/recipes/[recipeVersionId]",
    family: "public-context",
  },
  {
    file: "app/recipes/new/page.tsx",
    route: "/recipes/new",
    family: "recipe-authoring",
  },
  { file: "app/recipes/page.tsx", route: "/recipes", family: "discovery" },
  { file: "app/sign-in/page.tsx", route: "/sign-in", family: "account-access" },
] as const satisfies readonly PageThemeInventoryItem[];

export const RCP46_ROUTE_STATE_THEME_INVENTORY = [
  {
    file: "app/account/ingredient-requests/loading.tsx",
    kind: "loading",
    family: "account-workspace",
  },
  {
    file: "app/account/recipe-drafts/[draftId]/error.tsx",
    kind: "error",
    family: "recipe-authoring",
  },
  {
    file: "app/account/recipe-drafts/[draftId]/loading.tsx",
    kind: "loading",
    family: "recipe-authoring",
  },
  {
    file: "app/account/recipe-drafts/[draftId]/not-found.tsx",
    kind: "not-found",
    family: "recipe-authoring",
  },
  {
    file: "app/account/recipe-drafts/loading.tsx",
    kind: "loading",
    family: "account-workspace",
  },
  {
    file: "app/account/recipes/loading.tsx",
    kind: "loading",
    family: "account-workspace",
  },
  {
    file: "app/account/saved-recipes/loading.tsx",
    kind: "loading",
    family: "account-workspace",
  },
  {
    file: "app/account/settings/loading.tsx",
    kind: "loading",
    family: "account-workspace",
  },
  {
    file: "app/auth/callback/error.tsx",
    kind: "error",
    family: "account-access",
  },
  {
    file: "app/auth/callback/loading.tsx",
    kind: "loading",
    family: "account-access",
  },
  {
    file: "app/catalog/ingredient-requests/loading.tsx",
    kind: "loading",
    family: "staff-curation",
  },
  {
    file: "app/cooks/[handle]/error.tsx",
    kind: "error",
    family: "public-context",
  },
  {
    file: "app/cooks/[handle]/loading.tsx",
    kind: "loading",
    family: "public-context",
  },
  {
    file: "app/cooks/[handle]/not-found.tsx",
    kind: "not-found",
    family: "public-context",
  },
  {
    file: "app/moderation/recipes/loading.tsx",
    kind: "loading",
    family: "staff-moderation",
  },
  { file: "app/not-found.tsx", kind: "not-found", family: "system-state" },
  {
    file: "app/onboarding/error.tsx",
    kind: "error",
    family: "account-access",
  },
  {
    file: "app/onboarding/loading.tsx",
    kind: "loading",
    family: "account-access",
  },
  {
    file: "app/recipes/[recipeVersionId]/compare/error.tsx",
    kind: "error",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/compare/loading.tsx",
    kind: "loading",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/compare/not-found.tsx",
    kind: "not-found",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/error.tsx",
    kind: "error",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/loading.tsx",
    kind: "loading",
    family: "public-context",
  },
  {
    file: "app/recipes/[recipeVersionId]/not-found.tsx",
    kind: "not-found",
    family: "public-context",
  },
  { file: "app/recipes/error.tsx", kind: "error", family: "discovery" },
  { file: "app/recipes/loading.tsx", kind: "loading", family: "discovery" },
] as const satisfies readonly RouteStateThemeInventoryItem[];
