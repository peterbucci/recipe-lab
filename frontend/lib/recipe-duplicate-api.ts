import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type PublicApiErrorContract,
} from "./api-transport/core";
import { isRecipeVersionId } from "./recipe-api";

type RecipeDuplicateOperation =
  operations["create_original_draft_duplicate_preflight_api_recipe_drafts__draft_id__duplicate_preflights_post"];
type RecipeDuplicateInput =
  RecipeDuplicateOperation["requestBody"]["content"]["application/json"];
type RecipeDuplicateWire =
  RecipeDuplicateOperation["responses"][201]["content"]["application/json"];

export type RecipeDuplicateClassification =
  "exact_duplicate" | "probable_duplicate" | "distinct";
export type RecipeDuplicateCandidateClassification = Exclude<
  RecipeDuplicateClassification,
  "distinct"
>;
export type RecipeDuplicateDecision = "continue" | "revise";

export interface RecipeDuplicateReason {
  code: string;
  message: string;
}

export interface RecipeDuplicateCandidate {
  public_recipe_version_id: string;
  title: string;
  classification: RecipeDuplicateCandidateClassification;
  score: string;
  reasons: RecipeDuplicateReason[];
}

export interface RecipeDuplicateAcknowledgement {
  preflight_id: string;
  policy_version: string;
  result_digest: string;
  required: boolean;
  allowed_decisions: RecipeDuplicateDecision[];
}

export interface RecipeDuplicatePreflight {
  classification: RecipeDuplicateClassification;
  same_lineage_no_change: boolean;
  candidates: RecipeDuplicateCandidate[];
  warnings: Array<{
    code: "same_lineage_no_change";
    message: string;
  }>;
  acknowledgement: RecipeDuplicateAcknowledgement;
}

const KNOWN_RECIPE_DUPLICATE_ERROR_CODES = new Set([
  "abuse_protection_unavailable",
  "account_setup_required",
  "authentication_required",
  "duplicate_decision_not_required",
  "duplicate_preflight_not_found",
  "duplicate_preflight_stale",
  "duplicate_preflight_unavailable",
  "idempotency_key_conflict",
  "invalid_csrf",
  "invalid_identifier",
  "invalid_recipe_edits",
  "rate_limit_exceeded",
  "recipe_fork_source_unavailable",
  "recipe_not_found",
  "validation_error",
]);

const RECIPE_DUPLICATE_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "recipe_duplicate_api_error",
  knownCodes: KNOWN_RECIPE_DUPLICATE_ERROR_CODES,
};

export class RecipeDuplicateApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code = "recipe_duplicate_api_error",
  ) {
    super(message);
    this.name = "RecipeDuplicateApiError";
    this.status = status;
    this.code = code;
  }
}

const POLICY_VERSION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const REASON_CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SCORE_PATTERN = /^(?:0|1)\.\d{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function parseReason(value: unknown): RecipeDuplicateReason | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["code", "message"]) ||
    !isBoundedText(value.code, 64) ||
    !REASON_CODE_PATTERN.test(value.code) ||
    !isBoundedText(value.message, 200)
  ) {
    return null;
  }
  return { code: value.code, message: value.message };
}

function parseCandidate(value: unknown): RecipeDuplicateCandidate | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "public_recipe_version_id",
      "title",
      "classification",
      "score",
      "reasons",
    ]) ||
    typeof value.public_recipe_version_id !== "string" ||
    !isRecipeVersionId(value.public_recipe_version_id) ||
    !isBoundedText(value.title, 200) ||
    (value.classification !== "exact_duplicate" &&
      value.classification !== "probable_duplicate") ||
    typeof value.score !== "string" ||
    !SCORE_PATTERN.test(value.score) ||
    Number(value.score) < 0 ||
    Number(value.score) > 1 ||
    !Array.isArray(value.reasons) ||
    value.reasons.length < 1 ||
    value.reasons.length > 3
  ) {
    return null;
  }

  const reasons = value.reasons.map(parseReason);
  if (reasons.some((reason) => reason === null)) {
    return null;
  }
  const parsedReasons = reasons as RecipeDuplicateReason[];
  if (
    new Set(parsedReasons.map((reason) => reason.code)).size !==
    parsedReasons.length
  ) {
    return null;
  }

  return {
    public_recipe_version_id: value.public_recipe_version_id,
    title: value.title,
    classification: value.classification,
    score: value.score,
    reasons: parsedReasons,
  };
}

function parseAcknowledgement(
  value: unknown,
): RecipeDuplicateAcknowledgement | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "preflight_id",
      "policy_version",
      "result_digest",
      "required",
      "allowed_decisions",
    ]) ||
    typeof value.preflight_id !== "string" ||
    !isRecipeVersionId(value.preflight_id) ||
    !isBoundedText(value.policy_version, 64) ||
    !POLICY_VERSION_PATTERN.test(value.policy_version) ||
    typeof value.result_digest !== "string" ||
    !SHA256_PATTERN.test(value.result_digest) ||
    typeof value.required !== "boolean" ||
    !Array.isArray(value.allowed_decisions) ||
    !value.allowed_decisions.every(
      (decision) => decision === "continue" || decision === "revise",
    ) ||
    new Set(value.allowed_decisions).size !== value.allowed_decisions.length
  ) {
    return null;
  }

  const allowedDecisions = value.allowed_decisions as RecipeDuplicateDecision[];
  if (
    (value.required &&
      (allowedDecisions.length !== 2 ||
        !allowedDecisions.includes("continue") ||
        !allowedDecisions.includes("revise"))) ||
    (!value.required && allowedDecisions.length !== 0)
  ) {
    return null;
  }

  return {
    preflight_id: value.preflight_id,
    policy_version: value.policy_version,
    result_digest: value.result_digest,
    required: value.required,
    allowed_decisions: allowedDecisions,
  };
}

function candidatesAreInStableOrder(
  candidates: RecipeDuplicateCandidate[],
): boolean {
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1];
    const current = candidates[index];
    if (!previous || !current) {
      return false;
    }
    const previousClass = previous.classification === "exact_duplicate" ? 0 : 1;
    const currentClass = current.classification === "exact_duplicate" ? 0 : 1;
    if (previousClass > currentClass) {
      return false;
    }
    if (previousClass < currentClass) {
      continue;
    }
    const previousScore = Number(previous.score);
    const currentScore = Number(current.score);
    if (previousScore < currentScore) {
      return false;
    }
    if (
      previousScore === currentScore &&
      previous.public_recipe_version_id.toLowerCase() >
        current.public_recipe_version_id.toLowerCase()
    ) {
      return false;
    }
  }
  return true;
}

export function parseRecipeDuplicatePreflight(
  value: unknown,
): RecipeDuplicatePreflight {
  const invalid = () =>
    new RecipeDuplicateApiError(
      "Recipe Lab received an invalid similarity review response.",
      502,
      "invalid_recipe_duplicate_response",
    );

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "classification",
      "same_lineage_no_change",
      "candidates",
      "warnings",
      "acknowledgement",
    ]) ||
    (value.classification !== "exact_duplicate" &&
      value.classification !== "probable_duplicate" &&
      value.classification !== "distinct") ||
    typeof value.same_lineage_no_change !== "boolean" ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 5 ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > 1
  ) {
    throw invalid();
  }

  const candidates = value.candidates.map(parseCandidate);
  const acknowledgement = parseAcknowledgement(value.acknowledgement);
  const warnings = value.warnings.flatMap((warning) => {
    if (
      !isRecord(warning) ||
      !hasExactKeys(warning, ["code", "message"]) ||
      warning.code !== "same_lineage_no_change" ||
      !isBoundedText(warning.message, 200)
    ) {
      return [];
    }
    return [{ code: warning.code, message: warning.message }] as const;
  });

  if (
    acknowledgement === null ||
    candidates.some((candidate) => candidate === null) ||
    warnings.length !== value.warnings.length
  ) {
    throw invalid();
  }

  const parsedCandidates = candidates as RecipeDuplicateCandidate[];
  const candidateIds = parsedCandidates.map((candidate) =>
    candidate.public_recipe_version_id.toLowerCase(),
  );
  const isDistinct = value.classification === "distinct";
  if (
    new Set(candidateIds).size !== candidateIds.length ||
    !candidatesAreInStableOrder(parsedCandidates) ||
    parsedCandidates.some(
      (candidate) =>
        candidate.classification === "exact_duplicate" &&
        candidate.score !== "1.000000",
    ) ||
    acknowledgement.required === isDistinct ||
    (isDistinct && (parsedCandidates.length !== 0 || warnings.length !== 0)) ||
    value.same_lineage_no_change !== (warnings.length === 1) ||
    (value.same_lineage_no_change &&
      value.classification !== "exact_duplicate") ||
    (value.classification === "exact_duplicate" &&
      !value.same_lineage_no_change &&
      !parsedCandidates.some(
        (candidate) => candidate.classification === "exact_duplicate",
      )) ||
    (value.classification === "probable_duplicate" &&
      (parsedCandidates.length === 0 ||
        !parsedCandidates.every(
          (candidate) => candidate.classification === "probable_duplicate",
        )))
  ) {
    throw invalid();
  }

  return {
    classification: value.classification,
    same_lineage_no_change: value.same_lineage_no_change,
    candidates: parsedCandidates,
    warnings,
    acknowledgement,
  };
}

function duplicateApiError(error: ApiTransportError): RecipeDuplicateApiError {
  const message =
    error.status === 401
      ? "Your session expired. Sign in again to continue."
      : error.status === 409 &&
          error.code === "recipe_fork_source_unavailable"
        ? "The public source recipe is no longer available. Your private draft is unchanged."
        : "Recipe Lab could not check this version right now. Your draft is still here; please try again.";
  return new RecipeDuplicateApiError(message, error.status, error.code);
}

async function duplicateMutation(
  path: string,
  body: unknown,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const requestFingerprint = await createRequestFingerprint({
    body_json: JSON.stringify(body),
    schema: "recipe-duplicate-preflight",
    version: 1,
  });
  try {
    const response = await browserApiRequest(path, {
      body: JSON.stringify(body),
      csrf: "member",
      errorContract: RECIPE_DUPLICATE_ERROR_CONTRACT,
      headers: { "Content-Type": "application/json" },
      identity: { idempotencyKey, requestFingerprint },
      kind: "mutation",
      method: "POST",
      signal,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (signal?.aborted) {
        throw new DOMException("The request was aborted.", "AbortError");
      }
      if (error.reason === "invalid_response") {
        throw new RecipeDuplicateApiError(
          "Recipe Lab received an invalid similarity review response.",
          502,
          "invalid_recipe_duplicate_response",
        );
      }
      throw duplicateApiError(error);
    }
    throw new RecipeDuplicateApiError(
      "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
      0,
    );
  }
}

export async function createRecipeDraftDuplicatePreflight(
  draftId: string,
  revision: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<RecipeDuplicatePreflight> {
  const input: RecipeDuplicateInput = { revision };
  const result = (await duplicateMutation(
    `/api/recipe-drafts/${encodeURIComponent(draftId)}/duplicate-preflights`,
    input,
    idempotencyKey,
    signal,
  )) as RecipeDuplicateWire;
  return parseRecipeDuplicatePreflight(result);
}
