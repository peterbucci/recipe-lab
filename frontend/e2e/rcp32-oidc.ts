import { expect, type BrowserContext, type Page } from "@playwright/test";

export type Rcp32Identity = "alice" | "bob" | "curator" | "moderator";

interface IdentityDetails {
  displayName: string;
  handle: string;
  providerName: string;
}

export interface Rcp32Session {
  status: "authenticated";
  user: {
    display_name: string;
    handle: string;
    id: string;
  };
  capabilities: {
    moderate_recipe_reports: boolean;
    review_ingredient_requests: boolean;
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const identities: Record<Rcp32Identity, IdentityDetails> = {
  alice: {
    displayName: "Alice Cook",
    handle: "rcp32_alice",
    providerName: "Alice",
  },
  bob: {
    displayName: "Bob Cook",
    handle: "rcp32_bob",
    providerName: "Bob",
  },
  curator: {
    displayName: "Casey Curator",
    handle: "rcp32_curator",
    providerName: "Curator",
  },
  moderator: {
    displayName: "Morgan Moderator",
    handle: "rcp32_moderator",
    providerName: "Moderator",
  },
};

const deterministicUuidNamespaces: Record<Rcp32Identity, string> = {
  alice: "a1000001",
  bob: "b2000002",
  curator: "c3000003",
  moderator: "d4000004",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rcp32IdentityDetails(identity: Rcp32Identity): IdentityDetails {
  return identities[identity];
}

export async function installRcp32DeterministicUuids(
  context: BrowserContext,
  identity: Rcp32Identity,
): Promise<void> {
  await context.addInitScript(
    ({ namespace }) => {
      const storageKey = "__rcp32_uuid_sequence";
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => {
          let sequence = 0;
          try {
            sequence = Number(globalThis.sessionStorage.getItem(storageKey) ?? "0");
            sequence += 1;
            globalThis.sessionStorage.setItem(storageKey, String(sequence));
          } catch {
            sequence += 1;
          }
          return `${namespace}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
        },
      });
    },
    { namespace: deterministicUuidNamespaces[identity] },
  );
}

export async function readRcp32Session(page: Page): Promise<Rcp32Session> {
  const response = await page.request.get("/api/auth/session", {
    headers: { Accept: "application/json" },
  });
  expect(response.status()).toBe(200);
  const payload: unknown = await response.json();
  if (
    !isRecord(payload) ||
    payload.status !== "authenticated" ||
    !isRecord(payload.user) ||
    typeof payload.user.id !== "string" ||
    !uuidPattern.test(payload.user.id) ||
    typeof payload.user.display_name !== "string" ||
    typeof payload.user.handle !== "string" ||
    !isRecord(payload.capabilities) ||
    typeof payload.capabilities.review_ingredient_requests !== "boolean" ||
    typeof payload.capabilities.moderate_recipe_reports !== "boolean"
  ) {
    throw new Error("The RCP-32 authenticated-session contract was not satisfied.");
  }
  return payload as unknown as Rcp32Session;
}

async function chooseProviderIdentity(page: Page, identity: Rcp32Identity): Promise<void> {
  const details = identities[identity];
  const providerChoice = page.getByRole("button", {
    name: `Continue as ${details.providerName}`,
    exact: true,
  });
  await expect(providerChoice).toBeVisible();
  await providerChoice.click();
}

async function beginOidcSignIn(page: Page, identity: Rcp32Identity): Promise<void> {
  await page.goto("/sign-in");
  const continueLink = page.getByRole("link", { name: "Continue to sign in", exact: true });
  await continueLink.focus();
  await expect(continueLink).toBeFocused();
  await continueLink.press("Enter");
  await chooseProviderIdentity(page, identity);
}

export async function createAndOnboardRcp32Identity(
  page: Page,
  identity: Rcp32Identity,
): Promise<Rcp32Session> {
  const details = identities[identity];
  await beginOidcSignIn(page, identity);
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
  await page.getByLabel("Display name", { exact: true }).fill(details.displayName);
  await page.getByLabel("Handle", { exact: true }).fill(details.handle);
  await page.getByRole("button", { name: "Finish account setup", exact: true }).click();
  await expect(page.getByLabel(`Account menu for ${details.displayName}`)).toBeVisible();
  const session = await readRcp32Session(page);
  expect(session.user.display_name).toBe(details.displayName);
  expect(session.user.handle).toBe(details.handle);
  return session;
}

export async function signInExistingRcp32Identity(
  page: Page,
  identity: Rcp32Identity,
): Promise<Rcp32Session> {
  const details = identities[identity];
  await beginOidcSignIn(page, identity);
  await expect(page).not.toHaveURL(/\/onboarding(?:\?|$)/);
  await expect(page.getByLabel(`Account menu for ${details.displayName}`)).toBeVisible();
  const session = await readRcp32Session(page);
  expect(session.user.display_name).toBe(details.displayName);
  expect(session.user.handle).toBe(details.handle);
  return session;
}

export async function rcp32CsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === "recipe_lab_csrf")?.value;
  if (!csrf) {
    throw new Error("The authenticated RCP-32 context is missing its CSRF cookie.");
  }
  return csrf;
}
