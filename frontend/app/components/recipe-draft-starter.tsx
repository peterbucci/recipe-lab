"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { AuthApiError } from "../../lib/auth-api";
import { createRecipeDraft, RecipeDraftApiError } from "../../lib/recipe-draft-api";
import { MemberRouteGate } from "./member-route-gate";
import { GuardedLink } from "./navigation-blocker-provider";

interface RecipeDraftStarterProps {
  recipeTitle?: string;
  sourceVersionId: string | null;
}

export function RecipeDraftStarter({ recipeTitle, sourceVersionId }: RecipeDraftStarterProps) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const returnTo = sourceVersionId
    ? `/recipes/${encodeURIComponent(sourceVersionId)}/fork`
    : "/recipes/new";
  const isFork = sourceVersionId !== null;

  async function start() {
    if (pendingRef.current || pending) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const draft = await createRecipeDraft(sourceVersionId);
      router.replace(`/account/recipe-drafts/${encodeURIComponent(draft.id)}`);
    } catch (reason) {
      setError(
        reason instanceof RecipeDraftApiError || reason instanceof AuthApiError
          ? reason.message
          : "Recipe Lab could not start this private draft. Please try again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <MemberRouteGate eyebrow="Private recipe workspace" returnTo={returnTo} title="Private drafts">
      <main id="main-content" className="page-shell page-shell--detail">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <GuardedLink href={sourceVersionId ? `/recipes/${sourceVersionId}` : "/account/recipe-drafts"}>
            ← {sourceVersionId ? `Back to ${recipeTitle ?? "recipe"}` : "My recipe drafts"}
          </GuardedLink>
        </nav>
        <section className="draft-starter" aria-labelledby="draft-starter-title">
          <p className="eyebrow">{isFork ? "Start from a recipe" : "Original recipe"}</p>
          <h1 id="draft-starter-title">
            {isFork ? `Make ${recipeTitle ?? "this recipe"} your own.` : "Start a new recipe draft."}
          </h1>
          <p className="lede">
            {isFork
              ? "Recipe Lab will copy the exact public version into a new private draft. The source recipe stays unchanged."
              : "Your work stays private until a later publishing step. You can save an incomplete recipe and come back anytime."}
          </p>
          <div className="draft-starter__privacy">
            <strong>Private by default</strong>
            <p>This draft will not appear in search, activity, or public recipe pages.</p>
          </div>
          {error ? <p className="form-alert" role="alert">{error}</p> : null}
          <div className="button-row">
            <button className="button button--primary" type="button" disabled={pending} onClick={() => void start()}>
              {pending ? "Creating private draft…" : isFork ? "Create private draft" : "Start writing"}
            </button>
            <GuardedLink className="button button--secondary" href={sourceVersionId ? `/recipes/${sourceVersionId}` : "/account/recipe-drafts"}>
              Cancel
            </GuardedLink>
          </div>
        </section>
      </main>
    </MemberRouteGate>
  );
}
