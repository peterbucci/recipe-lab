import { describe, expect, it } from "vitest";

import { RecipeLibraryApiError } from "./recipe-library-error";
import { parseRecipeLibraryPageEnvelope } from "./recipe-library-page-parser";

describe("recipe library page parsing", () => {
  it("accepts extra input while projecting only the private library envelope", () => {
    const items = [{ kind: "future-library-item" }];
    const result = parseRecipeLibraryPageEnvelope({
      counts: {
        drafts: 2,
        published: 3,
        saved: 5,
        withdrawn: 1,
        internal_count: 99,
      },
      items,
      page: 2,
      page_size: 12,
      total: 13,
      total_pages: 2,
      internal_account_state: "hidden",
    });

    expect(result).toEqual({
      counts: { drafts: 2, published: 3, saved: 5, withdrawn: 1 },
      items,
      page: 2,
      page_size: 12,
      total: 13,
      total_pages: 2,
    });
    expect(result).not.toHaveProperty("internal_account_state");
  });

  it("rejects malformed fields with the one Library error identity", () => {
    const envelope = {
      counts: { drafts: 0, published: 0, saved: 0, withdrawn: 0 },
      items: [],
      page: 1,
      page_size: 12,
      total: 0,
      total_pages: 0,
    };
    const invalidPages = [
      { items: null },
      { counts: null },
      { counts: { drafts: -1, published: 0, saved: 0, withdrawn: 0 } },
      { counts: { drafts: 0, published: 0, saved: 0 } },
      { page: 0 },
      { page_size: 0 },
      { page_size: 101 },
      { total: -1 },
      { total_pages: -1 },
    ];

    for (const invalid of invalidPages) {
      expect(() =>
        parseRecipeLibraryPageEnvelope({ ...envelope, ...invalid }),
      ).toThrow(RecipeLibraryApiError);
    }
  });
});
