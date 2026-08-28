import { describe, expect, it } from "vitest";

import {
  generateApiContractArtifacts,
  GENERATED_TYPES_PATH,
  normalizeGeneratedSource,
  parseOpenApiDocument,
} from "./api-contract-codegen.mjs";

function operation({ operationId } = {}) {
  return {
    operationId,
    responses: { 200: { description: "OK" } },
  };
}

function document(paths = {}) {
  return {
    components: { schemas: {} },
    info: { title: "Test", version: "1" },
    openapi: "3.1.0",
    paths,
  };
}

describe("API contract code generation", () => {
  it("requires a complete OpenAPI 3.1 JSON document", () => {
    expect(() => parseOpenApiDocument("not-json")).toThrow("not valid JSON");
    expect(() =>
      parseOpenApiDocument(JSON.stringify({ openapi: "3.0.3", paths: {} })),
    ).toThrow("complete OpenAPI 3.1 document");
    expect(parseOpenApiDocument(JSON.stringify(document()))).toMatchObject({
      openapi: "3.1.0",
    });
  });

  it("normalizes Windows checkout line endings without accepting lone carriage returns", () => {
    expect(normalizeGeneratedSource("first\r\nsecond\r\n")).toBe(
      "first\nsecond\n",
    );
    expect(() => normalizeGeneratedSource("first\rsecond")).toThrow(
      "unsupported line ending",
    );
  });

  it("generates one deterministic TypeScript contract from the parsed document", async () => {
    const sharedDocument = document({
      "/api/examples": {
        post: {
          ...operation({ operationId: "submit_example" }),
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: { value: { type: "string" } },
                  required: ["value"],
                  type: "object",
                },
              },
            },
            required: true,
          },
        },
      },
    });

    const first = await generateApiContractArtifacts(sharedDocument);
    const second = await generateApiContractArtifacts(sharedDocument);

    expect([...second]).toEqual([...first]);
    expect([...first.keys()]).toEqual([GENERATED_TYPES_PATH]);
    expect(first.get(GENERATED_TYPES_PATH)).toContain(
      "readonly submit_example: {",
    );
  });
});
