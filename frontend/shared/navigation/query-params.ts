export type QueryParamValue = string | string[] | undefined;

export const MAX_QUERY_PAGE = 1_000_000;

export function firstQueryValue(value: QueryParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseAllowedQueryValue<const Values extends readonly string[]>(
  value: QueryParamValue,
  allowedValues: Values,
  fallback: Values[number],
): Values[number] {
  const candidate = firstQueryValue(value);
  return allowedValues.find((allowedValue) => allowedValue === candidate) ?? fallback;
}

export function parsePositivePageNumber(
  value: QueryParamValue,
  max = MAX_QUERY_PAGE,
): number {
  const candidate = firstQueryValue(value);
  if (!candidate || !/^\d+$/.test(candidate)) return 1;

  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : 1;
}
