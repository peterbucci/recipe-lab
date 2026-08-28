import { describe, expect, expectTypeOf, it } from "vitest";

import type { operations } from "./generated";

type ReportOperation =
  operations["report_recipe_api_recipes__recipe_version_id__reports_post"];
type ReportRequest =
  ReportOperation["requestBody"]["content"]["application/json"];
type ReportReplayReceipt =
  ReportOperation["responses"][200]["content"]["application/json"];
type ReportCreatedReceipt =
  ReportOperation["responses"][201]["content"]["application/json"];
type ReportReceipt = ReportReplayReceipt | ReportCreatedReceipt;

describe("generated API contracts", () => {
  it("derives request and response types from OpenAPI while tolerating additive data", () => {
    const request: ReportRequest = { details: null, reason: "spam" };
    const additiveServerValue = {
      id: "22222222-2222-4222-8222-222222222222",
      recipe_version_id: "11111111-1111-4111-8111-111111111111",
      submitted_at: "2026-08-26T12:00:00Z",
      future_field: "ignored by ordinary structural consumers",
    };
    const receipt: ReportReceipt = additiveServerValue;

    expect(request.reason).toBe("spam");
    expect(receipt.id).toBe(additiveServerValue.id);
    expectTypeOf(request.reason).toEqualTypeOf<
      | "dangerous_content"
      | "harassment"
      | "intellectual_property"
      | "other"
      | "spam"
    >();
    expectTypeOf<ReportReplayReceipt>().toEqualTypeOf<ReportCreatedReceipt>();
  });
});
