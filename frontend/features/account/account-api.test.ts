import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../shared/api/browser-session";
import { deleteAccount, updateAccountProfile } from "./account-api";

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

describe("account API client", () => {
  it("sends profile and deletion mutations with the member CSRF token", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token%20value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateAccountProfile({
        handle: "alice",
        display_name: "Alice Cook",
        description: "Home cook.",
      }),
    ).resolves.toMatchObject({ status: "authenticated" });
    await expect(deleteAccount("alice")).resolves.toBeUndefined();

    const [profileTarget, profileInit] = fetchMock.mock.calls[0];
    expect(profileTarget).toBe("/api/auth/session/profile");
    expect(profileInit).toMatchObject({
      method: "PATCH",
      credentials: "same-origin",
      body: JSON.stringify({
        handle: "alice",
        display_name: "Alice Cook",
        description: "Home cook.",
      }),
    });
    const profileHeaders = new Headers(profileInit?.headers);
    expect(profileHeaders.get("Accept")).toBe("application/json");
    expect(profileHeaders.get("Content-Type")).toBe("application/json");
    expect(profileHeaders.get("X-CSRF-Token")).toBe("token value");

    const [deleteTarget, deleteInit] = fetchMock.mock.calls[1];
    expect(deleteTarget).toBe("/api/auth/account");
    expect(deleteInit).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ confirmation: "alice" }),
    });
    const deleteHeaders = new Headers(deleteInit?.headers);
    expect(deleteHeaders.get("Accept")).toBe("application/json");
    expect(deleteHeaders.get("Content-Type")).toBe("application/json");
    expect(deleteHeaders.get("X-CSRF-Token")).toBe("token value");
  });

  it("preserves known account codes without retaining backend messages", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "handle_unavailable",
              message: `Canonical handle policy ${internalId} rejected this operator request.`,
              issues: [],
            },
          },
          { status: 409 },
        ),
      ),
    );

    const error = await updateAccountProfile({
      handle: "alice",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      status: 409,
      code: "handle_unavailable",
      message: "That handle is unavailable.",
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /canonical|policy|operator|99999999/i,
    );
  });

  it("drops unknown account codes and preserves recent-authentication behavior", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "private_operator_policy_failure",
                message: `Account UUID ${internalId} failed canonical policy.`,
                issues: [],
              },
            },
            { status: 409 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recent_authentication_required",
                message: `Operator policy ${internalId} requires reauthentication.`,
                issues: [],
              },
            },
            { status: 403 },
          ),
        ),
    );

    const unknown = await updateAccountProfile({
      handle: "alice",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);
    expect(unknown).toMatchObject({
      status: 409,
      code: "auth_api_error",
      message: "Recipe Lab could not update your account.",
      issues: [],
    });

    const recentAuthentication = await deleteAccount("alice").catch(
      (reason: unknown) => reason,
    );
    expect(recentAuthentication).toMatchObject({
      status: 403,
      code: "recent_authentication_required",
      message: "Sign in again to verify your identity before continuing.",
    });
    expect(
      `${String(unknown)} ${JSON.stringify(unknown)} ${String(recentAuthentication)} ${JSON.stringify(recentAuthentication)}`,
    ).not.toMatch(/canonical|policy|operator|99999999|private_operator/i);
  });

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
