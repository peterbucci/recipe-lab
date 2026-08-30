export const RCP46F_STAFF_VIEWPORTS = [
  { label: "desktop", width: 1_440, height: 900 },
  { label: "intermediate", width: 820, height: 1_000 },
  { label: "phone", width: 390, height: 844 },
] as const;

export const RCP46F_STAFF_ROUTES = {
  curator: {
    path: "/catalog/ingredient-requests",
    capability: "review_ingredient_requests",
    navigationLabel: "Review ingredient requests",
    apiRouteLabel: "ingredient-review-queue",
    authorizationDeniedApiRouteLabel: "ingredient-review-authorization-denied",
  },
  moderator: {
    path: "/moderation/recipes",
    capability: "moderate_recipe_reports",
    navigationLabel: "Review recipe reports",
    apiRouteLabel: "moderation-queue",
    authorizationDeniedApiRouteLabel: "moderation-authorization-denied",
  },
} as const;

export type Rcp46fStaffRole = keyof typeof RCP46F_STAFF_ROUTES;

export type Rcp46fStaffState =
  | "normal"
  | "loading"
  | "error"
  | "empty"
  | "not-found"
  | "authorization"
  | "stale"
  | "retry";

export interface Rcp46fStaffMatrixCase {
  readonly id: string;
  readonly sessionRole: Rcp46fStaffRole;
  readonly routeRole: Rcp46fStaffRole;
  readonly scenario: string;
  readonly states: readonly Rcp46fStaffState[];
}

export const RCP46F_STAFF_STATE_MATRIX = [
  {
    id: "curator-normal",
    sessionRole: "curator",
    routeRole: "curator",
    scenario: "curator-session",
    states: ["normal"],
  },
  {
    id: "moderator-normal",
    sessionRole: "moderator",
    routeRole: "moderator",
    scenario: "moderator-session",
    states: ["normal"],
  },
  {
    id: "curator-loading",
    sessionRole: "curator",
    routeRole: "curator",
    scenario: "slow-curator-session",
    states: ["loading"],
  },
  {
    id: "moderator-error-retry",
    sessionRole: "moderator",
    routeRole: "moderator",
    scenario: "moderation-queue-failure-once",
    states: ["error", "retry"],
  },
  {
    id: "curator-empty",
    sessionRole: "curator",
    routeRole: "curator",
    scenario: "curation-empty",
    states: ["empty"],
  },
  {
    id: "moderator-detail-not-found",
    sessionRole: "moderator",
    routeRole: "moderator",
    scenario: "moderation-detail-not-found",
    states: ["not-found"],
  },
  {
    id: "curator-cannot-open-moderation",
    sessionRole: "curator",
    routeRole: "moderator",
    scenario: "curator-session",
    states: ["authorization"],
  },
  {
    id: "moderator-cannot-open-curation",
    sessionRole: "moderator",
    routeRole: "curator",
    scenario: "moderator-session",
    states: ["authorization"],
  },
  {
    id: "curator-stale-retry",
    sessionRole: "curator",
    routeRole: "curator",
    scenario: "curation-stale-once",
    states: ["stale", "retry"],
  },
] as const satisfies readonly Rcp46fStaffMatrixCase[];
