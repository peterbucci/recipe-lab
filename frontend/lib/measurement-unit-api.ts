export type UnitDimension =
  | "mass"
  | "volume"
  | "count"
  | "time"
  | "temperature"
  | "package";

export type MeasurementDisplayStyle = "symbol" | "word" | "hidden";

export type MeasurementSemantic =
  | "ingredient_amount"
  | "action_duration"
  | "temperature";

export interface CatalogUnit {
  id: string;
  key: string;
  dimension: UnitDimension;
  canonical_label: string;
  plural_label: string;
  symbol: string | null;
  display_style: MeasurementDisplayStyle;
  aliases: string[];
  active: boolean;
  provenance: string;
}

export type CatalogUnitSummary = Omit<CatalogUnit, "aliases" | "provenance">;

interface MeasurementUnitResponse {
  items: CatalogUnit[];
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export class MeasurementUnitApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "measurement_unit_api_error",
  ) {
    super(message);
    this.name = "MeasurementUnitApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isNonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDimension(value: unknown): value is UnitDimension {
  return (
    value === "mass" ||
    value === "volume" ||
    value === "count" ||
    value === "time" ||
    value === "temperature" ||
    value === "package"
  );
}

function isDisplayStyle(value: unknown): value is MeasurementDisplayStyle {
  return value === "symbol" || value === "word" || value === "hidden";
}

function parseCatalogUnit(value: unknown): CatalogUnit | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isBoundedText(value.key, 64) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.key) ||
    !isDimension(value.dimension) ||
    !isBoundedText(value.canonical_label, 64) ||
    !isBoundedText(value.plural_label, 64) ||
    (value.symbol !== null && !isBoundedText(value.symbol, 16)) ||
    !isDisplayStyle(value.display_style) ||
    (value.display_style === "symbol" && value.symbol === null) ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every((alias) => isBoundedText(alias, 64)) ||
    typeof value.active !== "boolean" ||
    !isNonBlankText(value.provenance)
  ) {
    return null;
  }

  return {
    id: value.id,
    key: value.key,
    dimension: value.dimension,
    canonical_label: value.canonical_label,
    plural_label: value.plural_label,
    symbol: value.symbol,
    display_style: value.display_style,
    aliases: value.aliases,
    active: value.active,
    provenance: value.provenance,
  };
}

export function parseMeasurementUnitResponse(value: unknown): MeasurementUnitResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new MeasurementUnitApiError(
      "Recipe Lab received an invalid measurement unit response.",
      502,
      "invalid_measurement_unit_response",
    );
  }

  const items = value.items.map(parseCatalogUnit);
  if (items.some((item) => item === null)) {
    throw new MeasurementUnitApiError(
      "Recipe Lab received an invalid measurement unit response.",
      502,
      "invalid_measurement_unit_response",
    );
  }

  const typedItems = items as CatalogUnit[];
  if (new Set(typedItems.map((item) => item.id)).size !== typedItems.length) {
    throw new MeasurementUnitApiError(
      "Recipe Lab received an invalid measurement unit response.",
      502,
      "invalid_measurement_unit_response",
    );
  }

  return { items: typedItems };
}

function apiBaseUrl(): string {
  const configured =
    process.env.RECIPE_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  return configured.trim().replace(/\/+$/, "");
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && "error" in value;
}

async function apiError(response: Response): Promise<MeasurementUnitApiError> {
  let message = "The measurement unit service could not complete this request.";
  let code = "measurement_unit_api_error";

  try {
    const payload: unknown = await response.json();
    if (isErrorPayload(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
    }
  } catch {
    // Keep the stable fallback when the upstream body is not JSON.
  }

  return new MeasurementUnitApiError(message, response.status, code);
}

export async function fetchMeasurementUnits(
  semantic: MeasurementSemantic,
): Promise<CatalogUnit[]> {
  const url = new URL("/api/measurement-units", `${apiBaseUrl()}/`);
  url.searchParams.set("semantic", semantic);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await apiError(response);
  }

  return parseMeasurementUnitResponse(await response.json()).items;
}

export function catalogUnitSummary(unit: CatalogUnit): CatalogUnitSummary {
  return {
    id: unit.id,
    key: unit.key,
    dimension: unit.dimension,
    canonical_label: unit.canonical_label,
    plural_label: unit.plural_label,
    symbol: unit.symbol,
    display_style: unit.display_style,
    active: unit.active,
  };
}
