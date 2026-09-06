import type { operations } from "../../shared/api/generated/generated";

import {
  AuthApiError,
  authRequest,
  memberMutationHeaders,
  parseAuthSession,
  type AuthenticatedAuthSession,
} from "../auth/auth-api";

type AccountProfileOperation =
  operations["update_account_profile_api_auth_session_profile_patch"];
type AccountDeletionOperation =
  operations["delete_account_api_auth_account_delete"];

export type AccountProfileInput =
  AccountProfileOperation["requestBody"]["content"]["application/json"];
type AccountDeletionInput =
  AccountDeletionOperation["requestBody"]["content"]["application/json"];

export async function updateAccountProfile(
  profile: AccountProfileInput,
): Promise<AuthenticatedAuthSession> {
  const body = profile satisfies AccountProfileInput;
  const response = await authRequest("/api/auth/session/profile", {
    kind: "mutation",
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...memberMutationHeaders(),
    },
    body: JSON.stringify(body),
  });
  const session = parseAuthSession(response.data);

  if (session.status !== "authenticated") {
    throw new AuthApiError(
      "Recipe Lab received an invalid account response.",
      502,
      "invalid_auth_response",
    );
  }

  return session;
}

export async function deleteAccount(confirmation: string): Promise<void> {
  const body = { confirmation } satisfies AccountDeletionInput;
  await authRequest("/api/auth/account", {
    kind: "mutation",
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...memberMutationHeaders(),
    },
    body: JSON.stringify(body),
    responseBody: "empty",
  });
}
