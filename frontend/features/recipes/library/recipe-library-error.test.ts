import { describe, expect, it } from "vitest";

import { ApiTransportError } from "../../../shared/api/core";
import {
  RecipeLibraryApiError,
  recipeLibraryErrorFromTransport,
} from "./recipe-library-error";

function transport(
  status: number,
  code: string,
  reason: "http" | "invalid_response" = "http",
) {
  return new ApiTransportError({
    code,
    reason,
    status,
  });
}

describe("recipe library errors", () => {
  it("preserves private session and account guidance under one Library error class", () => {
    const expired = recipeLibraryErrorFromTransport(
      transport(401, "authentication_required"),
    );
    const unavailable = recipeLibraryErrorFromTransport(
      transport(403, "account_setup_required"),
    );

    expect(expired).toBeInstanceOf(RecipeLibraryApiError);
    expect(expired).toMatchObject({
      code: "authentication_required",
      message: "Your session expired. Sign in again to load your recipes.",
      status: 401,
    });
    expect(unavailable).toBeInstanceOf(RecipeLibraryApiError);
    expect(unavailable).toMatchObject({
      code: "account_setup_required",
      message: "This recipe library is not available to your account.",
      status: 403,
    });
  });

  it("maps malformed transport data to the Library parser error identity", () => {
    expect(
      recipeLibraryErrorFromTransport(
        transport(502, "invalid_api_response", "invalid_response"),
      ),
    ).toMatchObject({
      code: "invalid_recipe_library_response",
      message: "Recipe Lab could not load this recipe library. Please try again.",
      name: "RecipeLibraryApiError",
      status: 502,
    });
  });
});
