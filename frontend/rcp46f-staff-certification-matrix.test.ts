import { describe, expect, it } from "vitest";

import {
  RCP46F_STAFF_ROUTES,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
  type Rcp46fStaffState,
} from "./e2e/rcp46f-staff-certification-matrix";

describe("RCP-46F staff certification inventory", () => {
  it("keeps curator and moderator routes and capabilities separate", () => {
    expect(RCP46F_STAFF_ROUTES).toEqual({
      curator: {
        path: "/catalog/ingredient-requests",
        capability: "review_ingredient_requests",
        navigationLabel: "Open ingredient catalog",
        apiRouteLabel: "ingredient-review-queue",
        authorizationDeniedApiRouteLabel:
          "ingredient-review-authorization-denied",
      },
      moderator: {
        path: "/moderation/recipes",
        capability: "moderate_recipe_reports",
        navigationLabel: "Open recipe reports",
        apiRouteLabel: "moderation-queue",
        authorizationDeniedApiRouteLabel: "moderation-authorization-denied",
      },
    });
    expect(RCP46F_STAFF_ROUTES.curator.capability).not.toBe(
      RCP46F_STAFF_ROUTES.moderator.capability,
    );
  });

  it("sweeps the reviewed widths with a lean, complete state matrix", () => {
    expect(RCP46F_STAFF_VIEWPORTS).toEqual([
      { label: "desktop", width: 1_440, height: 900 },
      { label: "intermediate", width: 820, height: 1_000 },
      { label: "phone", width: 390, height: 844 },
    ]);
    expect(RCP46F_STAFF_STATE_MATRIX).toHaveLength(9);
    expect(new Set(RCP46F_STAFF_STATE_MATRIX.map(({ id }) => id)).size).toBe(
      RCP46F_STAFF_STATE_MATRIX.length,
    );

    const coveredStates = new Set<Rcp46fStaffState>(
      RCP46F_STAFF_STATE_MATRIX.flatMap(({ states }) => states),
    );
    expect([...coveredStates].sort()).toEqual(
      [
        "authorization",
        "empty",
        "error",
        "loading",
        "normal",
        "not-found",
        "retry",
        "stale",
      ].sort(),
    );

    expect(
      RCP46F_STAFF_STATE_MATRIX.filter(({ states }) =>
        states.some((state) => state === "normal"),
      ).map(({ sessionRole, routeRole }) => [sessionRole, routeRole]),
    ).toEqual([
      ["curator", "curator"],
      ["moderator", "moderator"],
    ]);
    expect(
      RCP46F_STAFF_STATE_MATRIX.filter(({ states }) =>
        states.some((state) => state === "authorization"),
      ).map(({ sessionRole, routeRole }) => [sessionRole, routeRole]),
    ).toEqual([
      ["curator", "moderator"],
      ["moderator", "curator"],
    ]);
  });
});
