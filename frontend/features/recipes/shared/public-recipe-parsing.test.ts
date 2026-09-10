import { describe, expect, it } from "vitest";

import { parsePublicUserReference } from "./recipe-summary-parser";

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_COOK_ID = "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9";

describe("public recipe parsing", () => {
  it("allows only the fixed handleless Demo Cook compatibility identity", () => {
    const demoCook = {
      id: DEMO_COOK_ID,
      handle: null,
      display_name: "Demo Cook",
    };

    expect(parsePublicUserReference(demoCook)).toEqual(demoCook);
    expect(parsePublicUserReference({ ...demoCook, id: COOK_ID })).toBeNull();
    expect(
      parsePublicUserReference({ ...demoCook, display_name: "Another demo" }),
    ).toBeNull();
  });
});
