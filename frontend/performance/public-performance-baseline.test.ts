import { describe, expect, it } from "vitest";

import committedBaselineJson from "../../docs/baselines/rcp-34b-public-performance.json";
import {
  assertPerformanceBaselineDocument,
  assertPrivacySafeAggregate,
  BROWSER_ROUTE_LABELS,
  buildPerformanceBaselineCandidate,
  buildPerformanceObservation,
  metricBudget,
  nearestRankP95,
  performanceBudgetViolations,
  SERVICE_ROUTE_LABELS,
  type BrowserSample,
  type PerformanceBaselineDocument,
  type ServiceSample,
} from "./public-performance-baseline";

function committedBaseline(): PerformanceBaselineDocument {
  const value: unknown = committedBaselineJson;
  assertPerformanceBaselineDocument(value);
  return value;
}

function deterministicSamples(): {
  serviceSamples: ServiceSample[];
  browserSamples: BrowserSample[];
} {
  const serviceSamples = SERVICE_ROUTE_LABELS.flatMap((route, routeIndex) =>
    Array.from({ length: 20 }, (_, index) => ({
      route,
      latency_ms: routeIndex * 100 + index + 1,
    })),
  );
  const browserSamples = BROWSER_ROUTE_LABELS.flatMap((route, routeIndex) =>
    Array.from({ length: 7 }, (_, index) => {
      const value = routeIndex * 10 + index + 1;
      return {
        route,
        navigation_ms: value,
        lcp_ms: value + 100,
        cls: value / 10_000,
        long_task_total_ms: value + 200,
        responsiveness_ms: value + 300,
        decoded_js_bytes: value * 1_000,
      };
    }),
  );
  return { serviceSamples, browserSamples };
}

describe("public performance baseline aggregates", () => {
  it("accepts the committed machine-readable baseline and its explicit headroom", () => {
    const baseline = committedBaseline();

    expect(baseline.protocol.service).toMatchObject({
      warmup_runs_per_route: 3,
      measured_runs_per_route: 20,
    });
    expect(baseline.database_routes).toEqual({
      public_recipe_catalog_read: {
        baseline: { select_count: 3 },
        budget: { select_count: 3 },
      },
      public_recipe_detail_read: {
        baseline: { select_count: 8 },
        budget: { select_count: 10 },
      },
    });
    expect(
      metricBudget("latency_median_ms", 40, baseline.protocol.budget_policy),
    ).toBe(290);
    expect(
      metricBudget("decoded_js_median_bytes", 200_000, baseline.protocol.budget_policy),
    ).toBe(400_000);
    expect(metricBudget("cls_median", 0.02, baseline.protocol.budget_policy)).toBe(0.07);
  });

  it("uses deterministic medians and nearest-rank p95 without exact samples", () => {
    const { serviceSamples, browserSamples } = deterministicSamples();
    const observation = buildPerformanceObservation(
      committedBaseline(),
      serviceSamples,
      browserSamples,
    );

    expect(nearestRankP95(Array.from({ length: 20 }, (_, index) => index + 1))).toBe(19);
    expect(observation.service_routes.public_recipe_catalog_proxy).toEqual({
      latency_median_ms: 10.5,
      latency_p95_ms: 19,
    });
    expect(observation.browser_routes.public_home).toEqual({
      navigation_median_ms: 4,
      lcp_median_ms: 104,
      cls_median: 0.0004,
      long_task_total_median_ms: 204,
      responsiveness_median_ms: 304,
      decoded_js_median_bytes: 4_000,
    });
    expect(() =>
      buildPerformanceObservation(
        committedBaseline(),
        serviceSamples.slice(1),
        browserSamples,
      ),
    ).toThrow(/sample count/i);
  });

  it("builds a copy-ready candidate and reports only route-labeled budget failures", () => {
    const { serviceSamples, browserSamples } = deterministicSamples();
    const observation = buildPerformanceObservation(
      committedBaseline(),
      serviceSamples,
      browserSamples,
    );
    const baseline = committedBaseline();
    const candidate = buildPerformanceBaselineCandidate(
      observation,
      baseline.database_routes,
    );

    assertPerformanceBaselineDocument(candidate);
    expect(candidate.database_routes).toEqual(baseline.database_routes);
    expect(candidate.service_routes.public_recipe_catalog_proxy.budget).toEqual({
      latency_median_ms: 260.5,
      latency_p95_ms: 269,
    });
    const checkedObservation = structuredClone(observation);
    checkedObservation.service_routes.public_recipe_catalog_proxy.latency_median_ms = 261;
    expect(performanceBudgetViolations(checkedObservation, candidate)).toEqual([
      "public_recipe_catalog_proxy.latency_median_ms: observed 261, budget 260.5",
    ]);
  });

  it("rejects raw locations, identifiers, and unexpected route keys from artifacts", () => {
    expect(() =>
      assertPrivacySafeAggregate({
        service_routes: {
          public_recipe_catalog_proxy: {
            target_url: "http://internal.invalid/api/recipes",
          },
        },
      }),
    ).toThrow(/disallowed field/i);
    expect(() =>
      assertPrivacySafeAggregate({
        service_routes: {
          public_recipe_catalog_proxy: {
            value: "11111111-1111-4111-8111-111111111111",
          },
        },
      }),
    ).toThrow(/disallowed value/i);
    expect(() =>
      assertPrivacySafeAggregate({
        service_routes: {
          public_recipe_catalog_proxy: {
            value: "01890f3e-9c6a-7cc2-b5a2-8a5d7e5c1122",
          },
        },
      }),
    ).toThrow(/disallowed value/i);
    expect(() =>
      assertPrivacySafeAggregate({
        service_routes: {
          public_recipe_catalog_proxy: {
            value: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          },
        },
      }),
    ).toThrow(/disallowed value/i);
    expect(() =>
      assertPrivacySafeAggregate({
        service_routes: {
          public_recipe_catalog_proxy: {
            value: "/api/recipes/private-value",
          },
        },
      }),
    ).toThrow(/disallowed value/i);
    expect(() => assertPrivacySafeAggregate({ id: 42 })).toThrow(/disallowed field/i);
    expect(() => assertPrivacySafeAggregate({ sessionId: "opaque" })).toThrow(
      /disallowed field/i,
    );

    const invalid = structuredClone(committedBaselineJson) as Record<string, unknown>;
    const serviceRoutes = invalid.service_routes as Record<string, unknown>;
    serviceRoutes.raw_recipe = serviceRoutes.public_recipe_catalog_proxy;
    expect(() => assertPerformanceBaselineDocument(invalid)).toThrow(/fixed route labels/i);
  });
});
