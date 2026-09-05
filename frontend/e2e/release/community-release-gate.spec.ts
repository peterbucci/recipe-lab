import { test } from "@playwright/test";

import {
  closeCommunityReleaseJourney,
  createCommunityReleaseJourney,
} from "./community-release-gate-support";
import {
  approveMissingIngredient,
  interactWithRootRecipe,
  onboardCommunityMembers,
  publishChangedFork,
  publishExactFork,
  publishRootRecipe,
  requestMissingIngredient,
  verifyPublicLineage,
} from "./community-release-publication-stages";
import {
  deleteBobAndVerifyTombstones,
  emitRecoveryEvidence,
  moderateReportedRecipe,
  submitPrivateReport,
  verifyCrossUserAuthorization,
  verifyLogoutAndFreshSignIn,
  verifyPhoneRelease,
  withdrawRootRecipe,
} from "./community-release-security-stages";
import { assertRcp32AcceptanceDatabase } from "./community-release-operator";

test.describe("RCP-32 two-user community release gate", () => {
  test.describe.configure({ retries: 0, timeout: 420_000 });

  test("proves the complete real-provider community lifecycle", async ({
    browser,
  }) => {
    assertRcp32AcceptanceDatabase();
    if (!process.env.RCP32_MANIFEST_PATH?.trim()) {
      throw new Error(
        "RCP32_MANIFEST_PATH is required before starting the RCP-32 journey.",
      );
    }

    const journey = await createCommunityReleaseJourney(browser);
    try {
      await test.step("onboard four independent members through the real OIDC UI", async () => {
        await onboardCommunityMembers(journey);
      });

      await test.step("preserve Alice's draft while she requests a missing ingredient", async () => {
        await requestMissingIngredient(journey);
      });

      await test.step("grant only curator access, approve through the UI, then revoke it", async () => {
        await approveMissingIngredient(journey);
      });

      await test.step("resolve, structure, save, reload, and publish Alice's immutable root", async () => {
        await publishRootRecipe(journey);
      });

      await test.step("let Bob discover, view, save, rate, and idempotently re-save the root", async () => {
        await interactWithRootRecipe(journey);
      });

      await test.step("record Bob's explicit exact unchanged-fork continue decision", async () => {
        await publishExactFork(journey);
      });

      await test.step("publish Bob's real probable duplicate with controlled amount and action changes", async () => {
        await publishChangedFork(journey);
      });

      await test.step("prove immutable authorship, full direct-parent diff, and safe public payloads", async () => {
        await verifyPublicLineage(journey);
      });

      await test.step("deny Alice cross-user draft, withdrawal, author, and moderation powers", async () => {
        await verifyCrossUserAuthorization(journey);
      });

      await test.step("sign Bob out for real, revoke the old session, and require a fresh OIDC account choice", async () => {
        await verifyLogoutAndFreshSignIn(journey);
      });

      await test.step("submit one private report and keep ordinary members and curators out", async () => {
        await submitPrivateReport(journey);
      });

      await test.step("grant the separate moderator role, hide safely, restore, resolve, and revoke", async () => {
        await moderateReportedRecipe(journey);
      });

      await test.step("withdraw only Alice's parent while every public child survives", async () => {
        await withdrawRootRecipe(journey);
      });

      await test.step("run the read-only phone release check", async () => {
        await verifyPhoneRelease(journey);
      });

      await test.step("emit recovery evidence and allow an older backup before deletion", async () => {
        await emitRecoveryEvidence(journey);
      });

      await test.step("delete Bob last and retain tombstoned public lineage", async () => {
        await deleteBobAndVerifyTombstones(journey);
      });
    } finally {
      await closeCommunityReleaseJourney(journey);
    }
  });
});
