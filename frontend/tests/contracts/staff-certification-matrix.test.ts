import { describe, expect, it } from "vitest";

import {
  RCP46F_STAFF_ROUTES,
  RCP46F_STAFF_STATE_MATRIX,
  RCP46F_STAFF_VIEWPORTS,
  type Rcp46fStaffState,
} from "../../e2e/visual/staff-certification-matrix";

function includesState(
  states: readonly Rcp46fStaffState[],
  state: Rcp46fStaffState,
): boolean {
  return states.includes(state);
}

describe("RCP-46F staff certification inventory", () => {
  it("keeps curator and moderator routes and capabilities separate", () => {
    const routes = Object.values(RCP46F_STAFF_ROUTES);

    expect(new Set(routes.map(({ path }) => path)).size).toBe(routes.length);
    expect(new Set(routes.map(({ capability }) => capability)).size).toBe(
      routes.length,
    );
    expect(new Set(routes.map(({ apiRouteLabel }) => apiRouteLabel)).size).toBe(
      routes.length,
    );

    for (const route of routes) {
      expect(route.path).toMatch(/^\/[a-z0-9/-]+$/);
      expect(route.capability).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(route.navigationLabel).toMatch(/^Open /);
      expect(route.apiRouteLabel).not.toBe(route.authorizationDeniedApiRouteLabel);
      expect(route.authorizationDeniedApiRouteLabel).toContain(
        "authorization-denied",
      );
    }
  });

  it("sweeps the reviewed widths with a lean, complete state matrix", () => {
    const widths = RCP46F_STAFF_VIEWPORTS.map(({ width }) => width);
    expect(new Set(RCP46F_STAFF_VIEWPORTS.map(({ label }) => label)).size).toBe(
      RCP46F_STAFF_VIEWPORTS.length,
    );
    expect(RCP46F_STAFF_VIEWPORTS.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(1_024);
    expect(Math.min(...widths)).toBeLessThanOrEqual(480);
    expect(widths).toEqual([...widths].sort((left, right) => right - left));
    for (const { height, width } of RCP46F_STAFF_VIEWPORTS) {
      expect(height).toBeGreaterThan(0);
      expect(width).toBeGreaterThan(0);
    }

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

    const roles = Object.keys(RCP46F_STAFF_ROUTES).sort();
    const normalRoles = RCP46F_STAFF_STATE_MATRIX.filter(({ states }) =>
      includesState(states, "normal"),
    ).map(({ routeRole, sessionRole }) => {
      expect(sessionRole).toBe(routeRole);
      return routeRole;
    });
    expect(normalRoles.sort()).toEqual(roles);

    const authorizationPairs = RCP46F_STAFF_STATE_MATRIX.filter(({ states }) =>
      includesState(states, "authorization"),
    ).map(({ routeRole, sessionRole }) => {
      expect(sessionRole).not.toBe(routeRole);
      return `${sessionRole}->${routeRole}`;
    });
    const expectedAuthorizationPairs = roles.flatMap((sessionRole) =>
      roles
        .filter((routeRole) => routeRole !== sessionRole)
        .map((routeRole) => `${sessionRole}->${routeRole}`),
    );
    expect(authorizationPairs.sort()).toEqual(expectedAuthorizationPairs.sort());

    for (const matrixCase of RCP46F_STAFF_STATE_MATRIX) {
      expect(matrixCase.scenario).not.toHaveLength(0);
      if (includesState(matrixCase.states, "retry")) {
        expect(
          includesState(matrixCase.states, "error") ||
            includesState(matrixCase.states, "stale"),
        ).toBe(true);
      }
    }
  });
});
