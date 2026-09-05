import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../shared/api/browser-session";
import { updateAccountProfile } from "./account-api";

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

describe("account API client", () => {
  it("keeps only safe profile validation paths and replaces hostile issue details", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_error",
              message: `Canonical account policy ${internalId} failed.`,
              issues: [
                {
                  location: ["body", "handle"],
                  message: `Operator UUID ${internalId} failed the canonical policy.`,
                  type: "internal_handle_policy_failure",
                },
                {
                  location: ["body", "display_name"],
                  message: "Private operator detail.",
                  type: "internal_display_name_policy_failure",
                },
                {
                  location: ["body", "description"],
                  message: "Private profile moderation detail.",
                  type: "internal_description_policy_failure",
                },
                {
                  location: ["body", internalId],
                  message: "Private identifier detail.",
                  type: "internal_error",
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );

    const error = await updateAccountProfile({
      handle: "bad",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "validation_error",
      message:
        "Some account details need attention. Review them and try again.",
      issues: [
        {
          location: ["body", "handle"],
          message:
            "Use a handle with 3–30 lowercase letters, numbers, underscores, or hyphens.",
          type: "validation_error",
        },
        {
          location: ["body", "display_name"],
          message: "Enter a display name with 1–120 visible characters.",
          type: "validation_error",
        },
        {
          location: ["body", "description"],
          message: "Keep your profile description to 500 visible characters or fewer.",
          type: "validation_error",
        },
      ],
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /canonical|policy|operator|private|99999999|internal_/i,
    );
  });
});
