export const SERVICE_ROUTE_LABELS = [
  "public_recipe_catalog_proxy",
  "public_recipe_detail_proxy",
] as const;

export const BROWSER_ROUTE_LABELS = [
  "public_home",
  "public_recipe_catalog",
  "public_recipe_detail",
] as const;

export const DATABASE_ROUTE_LABELS = [
  "public_recipe_catalog_read",
  "public_recipe_detail_read",
] as const;

export type ServiceRouteLabel = (typeof SERVICE_ROUTE_LABELS)[number];
export type BrowserRouteLabel = (typeof BROWSER_ROUTE_LABELS)[number];
export type DatabaseRouteLabel = (typeof DATABASE_ROUTE_LABELS)[number];

export interface ServiceSample {
  route: ServiceRouteLabel;
  latency_ms: number;
}

export interface BrowserSample {
  route: BrowserRouteLabel;
  navigation_ms: number;
  lcp_ms: number;
  cls: number;
  long_task_total_ms: number;
  responsiveness_ms: number;
  decoded_js_bytes: number;
}

export interface ServiceAggregate {
  latency_median_ms: number;
  latency_p95_ms: number;
}

export interface BrowserAggregate {
  navigation_median_ms: number;
  lcp_median_ms: number;
  cls_median: number;
  long_task_total_median_ms: number;
  responsiveness_median_ms: number;
  decoded_js_median_bytes: number;
}

export interface DatabaseAggregate {
  select_count: number;
}

interface BaselineMetric<TAggregate> {
  baseline: TAggregate;
  budget: TAggregate;
}

export interface PerformanceEnvironment {
  profile: string;
  reference_runner: string;
  check_runner: string;
  browser: string;
  viewport_css_pixels: string;
  frontend: string;
  backend: string;
  database: string;
  transport: string;
  throttling: string;
}

export interface PerformanceProtocol {
  artifact_privacy: string;
  database: {
    fixture: string;
    measured_runs: number;
    aggregation: string;
    budget_policy: string;
  };
  service: {
    warmup_runs_per_route: number;
    measured_runs_per_route: number;
    aggregation: string;
  };
  browser: {
    warmup_navigations_per_route: number;
    measured_navigations_per_route: number;
    aggregation: string;
    responsiveness_probe: string;
    cache_profile: string;
  };
  budget_policy: {
    formula: string;
    relative_multiplier: number;
    absolute_headroom: {
      milliseconds: number;
      cls: number;
      bytes: number;
    };
  };
}

export interface PerformanceBaselineDocument {
  schema_version: 1;
  baseline_id: string;
  environment: PerformanceEnvironment;
  protocol: PerformanceProtocol;
  database_routes: Record<DatabaseRouteLabel, BaselineMetric<DatabaseAggregate>>;
  service_routes: Record<ServiceRouteLabel, BaselineMetric<ServiceAggregate>>;
  browser_routes: Record<BrowserRouteLabel, BaselineMetric<BrowserAggregate>>;
}

export interface PerformanceObservationDocument {
  schema_version: 1;
  baseline_id: string;
  observation_kind: "privacy_safe_aggregate";
  environment: PerformanceEnvironment;
  protocol: PerformanceProtocol;
  service_routes: Record<ServiceRouteLabel, ServiceAggregate>;
  browser_routes: Record<BrowserRouteLabel, BrowserAggregate>;
}

type NumericRecord = Record<string, number>;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const ULID_PATTERN = /\b[0-9A-HJKMNP-TV-Z]{26}\b/i;
const URL_PATTERN = /\bhttps?:\/\//i;
const RELATIVE_LOCATION_PATTERN = /(?:^|\s)\/(?:account|api|auth|catalog|cooks|moderation|recipes)(?:[/?#]|$)/i;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const FORBIDDEN_FIELD_PATTERN = /(^|_)(urls?|uris?|paths?|locations?|origins?|headers?|bod(?:y|ies)|accounts?|users?|members?|sessions?|cookies?|tokens?|actors?|identit(?:y|ies)|requests?|responses?|correlation(?:_id)?|recipe_version_id|ids?)(_|$)/i;

function finiteNumbers(values: number[], label: string): number[] {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} requires one or more finite, non-negative samples.`);
  }
  return values;
}

function rounded(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function median(values: number[]): number {
  const sorted = [...finiteNumbers(values, "median")].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function nearestRankP95(values: number[]): number {
  const sorted = [...finiteNumbers(values, "p95")].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function serviceAggregate(samples: ServiceSample[]): ServiceAggregate {
  const latency = samples.map((sample) => sample.latency_ms);
  return {
    latency_median_ms: rounded(median(latency), 1),
    latency_p95_ms: rounded(nearestRankP95(latency), 1),
  };
}

function browserAggregate(samples: BrowserSample[]): BrowserAggregate {
  return {
    navigation_median_ms: rounded(median(samples.map((sample) => sample.navigation_ms)), 1),
    lcp_median_ms: rounded(median(samples.map((sample) => sample.lcp_ms)), 1),
    cls_median: rounded(median(samples.map((sample) => sample.cls)), 4),
    long_task_total_median_ms: rounded(
      median(samples.map((sample) => sample.long_task_total_ms)),
      1,
    ),
    responsiveness_median_ms: rounded(
      median(samples.map((sample) => sample.responsiveness_ms)),
      1,
    ),
    decoded_js_median_bytes: Math.round(
      median(samples.map((sample) => sample.decoded_js_bytes)),
    ),
  };
}

function groupServiceSamples(
  samples: ServiceSample[],
): Record<ServiceRouteLabel, ServiceAggregate> {
  return Object.fromEntries(
    SERVICE_ROUTE_LABELS.map((route) => [
      route,
      serviceAggregate(samples.filter((sample) => sample.route === route)),
    ]),
  ) as Record<ServiceRouteLabel, ServiceAggregate>;
}

function groupBrowserSamples(
  samples: BrowserSample[],
): Record<BrowserRouteLabel, BrowserAggregate> {
  return Object.fromEntries(
    BROWSER_ROUTE_LABELS.map((route) => [
      route,
      browserAggregate(samples.filter((sample) => sample.route === route)),
    ]),
  ) as Record<BrowserRouteLabel, BrowserAggregate>;
}

function requireMeasuredSampleCounts(
  baseline: PerformanceBaselineDocument,
  serviceSamples: ServiceSample[],
  browserSamples: BrowserSample[],
): void {
  const expectedService = baseline.protocol.service.measured_runs_per_route;
  for (const route of SERVICE_ROUTE_LABELS) {
    if (serviceSamples.filter((sample) => sample.route === route).length !== expectedService) {
      throw new Error(`${route} does not have the required measured sample count.`);
    }
  }
  if (serviceSamples.length !== expectedService * SERVICE_ROUTE_LABELS.length) {
    throw new Error("Service samples contain an unexpected route label.");
  }

  const expectedBrowser = baseline.protocol.browser.measured_navigations_per_route;
  for (const route of BROWSER_ROUTE_LABELS) {
    if (browserSamples.filter((sample) => sample.route === route).length !== expectedBrowser) {
      throw new Error(`${route} does not have the required measured sample count.`);
    }
  }
  if (browserSamples.length !== expectedBrowser * BROWSER_ROUTE_LABELS.length) {
    throw new Error("Browser samples contain an unexpected route label.");
  }
}

export function buildPerformanceObservation(
  baseline: PerformanceBaselineDocument,
  serviceSamples: ServiceSample[],
  browserSamples: BrowserSample[],
): PerformanceObservationDocument {
  requireMeasuredSampleCounts(baseline, serviceSamples, browserSamples);
  const observation: PerformanceObservationDocument = {
    schema_version: 1,
    baseline_id: baseline.baseline_id,
    observation_kind: "privacy_safe_aggregate",
    environment: baseline.environment,
    protocol: baseline.protocol,
    service_routes: groupServiceSamples(serviceSamples),
    browser_routes: groupBrowserSamples(browserSamples),
  };
  assertPrivacySafeAggregate(observation);
  return observation;
}

function metricUnit(metric: string): keyof PerformanceProtocol["budget_policy"]["absolute_headroom"] {
  if (metric.endsWith("_bytes")) {
    return "bytes";
  }
  if (metric === "cls_median") {
    return "cls";
  }
  return "milliseconds";
}

export function metricBudget(
  metric: string,
  baseline: number,
  policy: PerformanceProtocol["budget_policy"],
): number {
  const unit = metricUnit(metric);
  const headroom = policy.absolute_headroom[unit];
  const candidate = Math.max(
    baseline * policy.relative_multiplier,
    baseline + headroom,
  );
  if (unit === "bytes") {
    return Math.ceil(candidate);
  }
  if (unit === "cls") {
    return Math.ceil(candidate * 10_000 - 1e-9) / 10_000;
  }
  return Math.ceil(candidate * 10 - 1e-9) / 10;
}

function budgetAggregate<TAggregate extends NumericRecord>(
  aggregate: TAggregate,
  policy: PerformanceProtocol["budget_policy"],
): TAggregate {
  return Object.fromEntries(
    Object.entries(aggregate).map(([metric, value]) => [
      metric,
      metricBudget(metric, value, policy),
    ]),
  ) as TAggregate;
}

export function buildPerformanceBaselineCandidate(
  observation: PerformanceObservationDocument,
  databaseRoutes: PerformanceBaselineDocument["database_routes"],
): PerformanceBaselineDocument {
  const policy = observation.protocol.budget_policy;
  const candidate: PerformanceBaselineDocument = {
    schema_version: 1,
    baseline_id: observation.baseline_id,
    environment: observation.environment,
    protocol: observation.protocol,
    database_routes: databaseRoutes,
    service_routes: Object.fromEntries(
      SERVICE_ROUTE_LABELS.map((route) => [
        route,
        {
          baseline: observation.service_routes[route],
          budget: budgetAggregate(
            observation.service_routes[route] as unknown as NumericRecord,
            policy,
          ) as unknown as ServiceAggregate,
        },
      ]),
    ) as Record<ServiceRouteLabel, BaselineMetric<ServiceAggregate>>,
    browser_routes: Object.fromEntries(
      BROWSER_ROUTE_LABELS.map((route) => [
        route,
        {
          baseline: observation.browser_routes[route],
          budget: budgetAggregate(
            observation.browser_routes[route] as unknown as NumericRecord,
            policy,
          ) as unknown as BrowserAggregate,
        },
      ]),
    ) as Record<BrowserRouteLabel, BaselineMetric<BrowserAggregate>>,
  };
  assertPrivacySafeAggregate(candidate);
  return candidate;
}

function aggregateViolations(
  route: string,
  observed: NumericRecord,
  budget: NumericRecord,
): string[] {
  return Object.entries(observed).flatMap(([metric, value]) =>
    value > budget[metric]!
      ? [`${route}.${metric}: observed ${value}, budget ${budget[metric]}`]
      : [],
  );
}

export function performanceBudgetViolations(
  observation: PerformanceObservationDocument,
  baseline: PerformanceBaselineDocument,
): string[] {
  return [
    ...SERVICE_ROUTE_LABELS.flatMap((route) =>
      aggregateViolations(
        route,
        observation.service_routes[route] as unknown as NumericRecord,
        baseline.service_routes[route].budget as unknown as NumericRecord,
      ),
    ),
    ...BROWSER_ROUTE_LABELS.flatMap((route) =>
      aggregateViolations(
        route,
        observation.browser_routes[route] as unknown as NumericRecord,
        baseline.browser_routes[route].budget as unknown as NumericRecord,
      ),
    ),
  ];
}

function walkFields(value: unknown, path: string[] = []): void {
  if (typeof value === "string") {
    if (
      UUID_PATTERN.test(value) ||
      ULID_PATTERN.test(value) ||
      URL_PATTERN.test(value) ||
      RELATIVE_LOCATION_PATTERN.test(value) ||
      EMAIL_PATTERN.test(value)
    ) {
      throw new Error(`Performance artifact contains a disallowed value at ${path.join(".")}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkFields(item, [...path, String(index)]));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    if (normalizedKey !== "baseline_id" && FORBIDDEN_FIELD_PATTERN.test(normalizedKey)) {
      throw new Error(`Performance artifact contains a disallowed field at ${[...path, key].join(".")}.`);
    }
    walkFields(item, [...path, key]);
  }
}

export function assertPrivacySafeAggregate(value: unknown): void {
  walkFields(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain only fixed route labels.`);
  }
}

function requirePositiveInteger(value: unknown, label: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function requireNonEmptyStrings(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      throw new Error(`${label}.${field} must be a non-empty string.`);
    }
  }
}

function requireAggregate(
  value: unknown,
  metricNames: readonly string[],
  label: string,
): NumericRecord {
  const aggregate = requireRecord(value, label);
  const keys = Object.keys(aggregate).sort();
  const expected = [...metricNames].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected metrics.`);
  }
  for (const [metric, metricValue] of Object.entries(aggregate)) {
    if (typeof metricValue !== "number" || !Number.isFinite(metricValue) || metricValue < 0) {
      throw new Error(`${label}.${metric} must be a finite, non-negative number.`);
    }
  }
  return aggregate as NumericRecord;
}

function requireBaselineRoute(
  value: unknown,
  metricNames: readonly string[],
  policy: PerformanceProtocol["budget_policy"],
  label: string,
): void {
  const route = requireRecord(value, label);
  const baseline = requireAggregate(route.baseline, metricNames, `${label}.baseline`);
  const budget = requireAggregate(route.budget, metricNames, `${label}.budget`);
  for (const [metric, baselineValue] of Object.entries(baseline)) {
    const expectedBudget = metricBudget(metric, baselineValue, policy);
    if (budget[metric] !== expectedBudget) {
      throw new Error(`${label}.budget.${metric} does not match the headroom policy.`);
    }
  }
}

export function assertPerformanceBaselineDocument(
  value: unknown,
): asserts value is PerformanceBaselineDocument {
  const document = requireRecord(value, "performance baseline");
  if (
    document.schema_version !== 1 ||
    typeof document.baseline_id !== "string" ||
    document.baseline_id.trim() === ""
  ) {
    throw new Error("Performance baseline schema metadata is invalid.");
  }
  const environment = requireRecord(document.environment, "performance baseline environment");
  requireNonEmptyStrings(
    environment,
    [
      "profile",
      "reference_runner",
      "check_runner",
      "browser",
      "viewport_css_pixels",
      "frontend",
      "backend",
      "database",
      "transport",
      "throttling",
    ],
    "performance baseline environment",
  );
  const protocol = requireRecord(document.protocol, "performance baseline protocol");
  const databaseProtocol = requireRecord(protocol.database, "database protocol");
  const serviceProtocol = requireRecord(protocol.service, "service protocol");
  const browserProtocol = requireRecord(protocol.browser, "browser protocol");
  requireNonEmptyStrings(protocol, ["artifact_privacy"], "performance baseline protocol");
  requireNonEmptyStrings(
    databaseProtocol,
    ["fixture", "aggregation", "budget_policy"],
    "database protocol",
  );
  requireNonEmptyStrings(serviceProtocol, ["aggregation"], "service protocol");
  requireNonEmptyStrings(
    browserProtocol,
    ["aggregation", "responsiveness_probe", "cache_profile"],
    "browser protocol",
  );
  requirePositiveInteger(databaseProtocol.measured_runs, "database measured runs");
  requirePositiveInteger(serviceProtocol.warmup_runs_per_route, "service warmup runs");
  requirePositiveInteger(serviceProtocol.measured_runs_per_route, "service measured runs");
  requirePositiveInteger(
    browserProtocol.warmup_navigations_per_route,
    "browser warmup navigations",
  );
  requirePositiveInteger(
    browserProtocol.measured_navigations_per_route,
    "browser measured navigations",
  );

  const policyRecord = requireRecord(protocol.budget_policy, "budget policy");
  requireNonEmptyStrings(policyRecord, ["formula"], "budget policy");
  const absoluteHeadroom = requireRecord(
    policyRecord.absolute_headroom,
    "budget absolute headroom",
  );
  if (
    typeof policyRecord.relative_multiplier !== "number" ||
    policyRecord.relative_multiplier <= 1 ||
    ["milliseconds", "cls", "bytes"].some(
      (unit) =>
        typeof absoluteHeadroom[unit] !== "number" ||
        (absoluteHeadroom[unit] as number) <= 0,
    )
  ) {
    throw new Error("Performance baseline budget headroom is invalid.");
  }
  const policy = protocol.budget_policy as PerformanceProtocol["budget_policy"];

  const databaseRoutes = requireRecord(document.database_routes, "database routes");
  const serviceRoutes = requireRecord(document.service_routes, "service routes");
  const browserRoutes = requireRecord(document.browser_routes, "browser routes");
  requireExactKeys(databaseRoutes, DATABASE_ROUTE_LABELS, "database routes");
  requireExactKeys(serviceRoutes, SERVICE_ROUTE_LABELS, "service routes");
  requireExactKeys(browserRoutes, BROWSER_ROUTE_LABELS, "browser routes");
  const serviceMetrics = ["latency_median_ms", "latency_p95_ms"];
  const browserMetrics = [
    "navigation_median_ms",
    "lcp_median_ms",
    "cls_median",
    "long_task_total_median_ms",
    "responsiveness_median_ms",
    "decoded_js_median_bytes",
  ];
  for (const route of DATABASE_ROUTE_LABELS) {
    const entry = requireRecord(databaseRoutes[route], `database_routes.${route}`);
    const baseline = requireAggregate(
      entry.baseline,
      ["select_count"],
      `database_routes.${route}.baseline`,
    );
    const budget = requireAggregate(
      entry.budget,
      ["select_count"],
      `database_routes.${route}.budget`,
    );
    if (
      !Number.isInteger(baseline.select_count) ||
      !Number.isInteger(budget.select_count) ||
      budget.select_count! < baseline.select_count!
    ) {
      throw new Error(`database_routes.${route} must use integer counts and a ceiling.`);
    }
  }
  for (const route of SERVICE_ROUTE_LABELS) {
    requireBaselineRoute(serviceRoutes[route], serviceMetrics, policy, `service_routes.${route}`);
  }
  for (const route of BROWSER_ROUTE_LABELS) {
    requireBaselineRoute(browserRoutes[route], browserMetrics, policy, `browser_routes.${route}`);
  }
  assertPrivacySafeAggregate(value);
}
