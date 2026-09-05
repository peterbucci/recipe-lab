import "server-only";

import {
  MeasurementUnitApiError,
  parseMeasurementUnitResponse,
  type CatalogUnit,
  type MeasurementSemantic,
  type MeasurementUnitQuery,
} from "./measurement-unit-model";

import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "../shared/api/core";

import { serverApiRequest } from "../shared/api/server";

const KNOWN_MEASUREMENT_UNIT_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "ingredient_density_ambiguous",
  "ingredient_density_required",
  "invalid_identifier",
  "invalid_semantic",
  "measurement_conversion_unsupported",
  "measurement_error",
  "measurement_metadata_mismatch",
  "measurement_semantic_mismatch",
  "measurement_unit_inactive",
  "measurement_unit_not_found",
  "measurement_value_out_of_range",
  "package_size_inactive",
  "package_size_not_found",
  "package_size_required",
  "rate_limit_exceeded",
  "validation_error",
]);

const MEASUREMENT_UNIT_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "measurement_unit_api_error",
  knownCodes: KNOWN_MEASUREMENT_UNIT_ERROR_CODES,
};

function measurementUnitErrorMessage(status: number): string {
  if (status === 404) return "That measurement option is no longer available.";
  if (status === 422) return "Review the measurement selection and try again.";
  if (status === 429) {
    return "The measurement catalog is receiving too many requests. Please wait and try again.";
  }
  return "The measurement unit service could not complete this request.";
}

function fromTransportError(error: ApiTransportError): MeasurementUnitApiError {
  if (error.reason === "invalid_response") {
    return new MeasurementUnitApiError(
      "Recipe Lab received an invalid measurement unit response.",
      502,
      "invalid_measurement_unit_response",
    );
  }
  return new MeasurementUnitApiError(
    measurementUnitErrorMessage(error.status),
    error.status,
    error.code,
  );
}

export async function fetchMeasurementUnits(
  semantic: MeasurementSemantic,
): Promise<CatalogUnit[]> {
  const query = { semantic } satisfies MeasurementUnitQuery;
  const search = new URLSearchParams({ semantic: query.semantic });
  try {
    const response = await serverApiRequest(
      `/api/measurement-units?${search.toString()}`,
      {
        errorContract: MEASUREMENT_UNIT_ERROR_CONTRACT,
        kind: "query",
      },
    );
    return parseMeasurementUnitResponse(response.data).items;
  } catch (error) {
    if (error instanceof MeasurementUnitApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw error;
  }
}
