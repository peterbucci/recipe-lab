import Link from "next/link";

import { PageLoadingSkeleton } from "../../../../shared/ui/page-loading-skeleton";
import { RetryableStatePage } from "../../../../shared/ui/retryable-state-page";
import { StatePage, StatePanel } from "../../../../shared/ui/state-page";

const MY_RECIPES_HREF = "/account/recipes?view=drafts";

interface RecipeDraftRetryableStateProps {
  retry: () => void;
}

interface RecipeDraftRouteErrorProps extends RecipeDraftRetryableStateProps {
  error: Error & { digest?: string };
}

function myRecipesAction(className: string) {
  return (
    <Link className={className} href={MY_RECIPES_HREF}>
      My recipes
    </Link>
  );
}

export function RecipeDraftRouteError({
  retry,
}: RecipeDraftRouteErrorProps) {
  return (
    <RetryableStatePage
      className="recipe-authoring-state"
      description="Try again, or return to My recipes."
      eyebrow="Something went wrong"
      headingId="recipe-draft-route-error-title"
      panelClassName="recipe-authoring-state__panel"
      retry={retry}
      secondaryAction={myRecipesAction("button button--secondary")}
      title="We couldn’t prepare the draft editor."
    />
  );
}

export function RecipeDraftLookupError({
  retry,
}: RecipeDraftRetryableStateProps) {
  return (
    <RetryableStatePage
      className="draft-editor-page draft-editor-page--error"
      description="Try again, or return to My recipes."
      eyebrow="Something went wrong"
      headingId="recipe-draft-lookup-error-title"
      panelClassName="draft-editor-page__error"
      retry={retry}
      secondaryAction={myRecipesAction("button button--secondary")}
      title="We couldn’t load this draft."
    />
  );
}

export function RecipeDraftUnavailableState() {
  return (
    <StatePage className="recipe-authoring-state">
      <StatePanel
        actions={myRecipesAction("button button--primary")}
        className="state-panel--large recipe-authoring-state__panel"
        description="Return to My recipes to choose a draft you can edit."
        eyebrow="Private draft unavailable"
        headingId="recipe-draft-unavailable-title"
        title="We couldn’t open that draft."
      />
    </StatePage>
  );
}

export function RecipeDraftLoadingView({
  status = "Loading your private draft…",
}: {
  status?: string;
}) {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-reading-page draft-editor-page draft-editor-page--loading recipe-workspace-page"
      exitHref={MY_RECIPES_HREF}
      exitLabel="My recipes"
      label={status}
      variant="authoring"
    />
  );
}
