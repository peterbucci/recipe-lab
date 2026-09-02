import type { RecipeDuplicatePreflight } from "./recipe-duplicate-api";
import type { RecipeDraftPublication } from "./recipe-publication-api";

export interface PublicationScope {
  fingerprint: string;
  revision: number;
}

export interface PublicationAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

export interface PublicationReview {
  result: RecipeDuplicatePreflight;
  scope: PublicationScope;
}

export interface PublicationContext extends PublicationReview {
  decision: "continue" | null;
}

export type PublicationFailureStatus =
  | "ambiguous-result"
  | "authentication-interruption"
  | "failed-retryable"
  | "revision-conflict"
  | "source-unavailable";

export type PublicationFailureRecovery =
  | "latest-draft"
  | "publish"
  | "review"
  | "source";

export type PublicationWorkflow =
  | { status: "idle" }
  | { phase: "validating"; status: "reviewing" }
  | { phase: "checking"; scope: PublicationScope; status: "reviewing" }
  | {
      acknowledged: boolean;
      review: PublicationReview;
      status: "confirmation";
    }
  | { acknowledged: boolean; context: PublicationContext; status: "publishing" }
  | {
      acknowledged: boolean;
      context: PublicationContext;
      receipt: RecipeDraftPublication;
      status: "published";
    }
  | {
      acknowledged: boolean;
      context: PublicationContext | null;
      message: string;
      operation: "preflight" | "publish";
      recovery: PublicationFailureRecovery;
      scope: PublicationScope;
      status: "failed";
      kind: PublicationFailureStatus;
    };

export interface RecipeDraftPublicationState {
  attempts: {
    preflight: PublicationAttempt | null;
    publish: PublicationAttempt | null;
  };
  workflow: PublicationWorkflow;
}

export type RecipeDraftPublicationEvent =
  | { type: "validation-started" }
  | { type: "validation-failed" }
  | {
      attempt: PublicationAttempt;
      scope: PublicationScope;
      type: "preflight-started";
    }
  | {
      attemptId: string;
      result: RecipeDuplicatePreflight;
      type: "review-required";
    }
  | { acknowledged: boolean; type: "acknowledgement-changed" }
  | {
      attempt: PublicationAttempt;
      context: PublicationContext;
      type: "publish-started";
    }
  | {
      attemptId: string;
      receipt: RecipeDraftPublication;
      type: "published";
    }
  | {
      attemptId: string;
      kind: PublicationFailureStatus;
      message: string;
      operation: "preflight" | "publish";
      resetReview: boolean;
      type: "operation-failed";
    }
  | { context: PublicationContext | null; type: "confirmation-paused" }
  | { type: "keep-editing" }
  | { type: "draft-changed" };

export const initialRecipeDraftPublicationState: RecipeDraftPublicationState = {
  attempts: { preflight: null, publish: null },
  workflow: { status: "idle" },
};

function sameScope(left: PublicationScope, right: PublicationScope): boolean {
  return (
    left.fingerprint === right.fingerprint && left.revision === right.revision
  );
}

export function publicationScopeMatches(
  scope: PublicationScope,
  current: PublicationScope,
  dirty: boolean,
): boolean {
  return !dirty && sameScope(scope, current);
}

export function preparePublicationAttempt(
  previous: PublicationAttempt | null,
  input: { fingerprint: string; newIdempotencyKey: string },
): PublicationAttempt {
  if (previous?.fingerprint === input.fingerprint) return previous;
  return {
    fingerprint: input.fingerprint,
    idempotencyKey: input.newIdempotencyKey,
  };
}

export function publicationIsBusy(state: RecipeDraftPublicationState): boolean {
  return (
    (state.workflow.status === "reviewing" &&
      state.workflow.phase === "checking") ||
    state.workflow.status === "publishing" ||
    state.workflow.status === "published"
  );
}

export function publicationBlocksDismissal(
  state: RecipeDraftPublicationState,
): boolean {
  return (
    publicationIsBusy(state) ||
    (state.workflow.status === "failed" &&
      state.workflow.kind === "ambiguous-result" &&
      state.workflow.recovery === "publish")
  );
}

export function publicationContext(
  workflow: PublicationWorkflow,
): PublicationContext | null {
  if (workflow.status === "publishing" || workflow.status === "published") {
    return workflow.context;
  }
  if (workflow.status === "failed") {
    return workflow.context;
  }
  return null;
}

export function publicationReview(
  workflow: PublicationWorkflow,
): { acknowledged: boolean; review: PublicationReview } | null {
  if (workflow.status === "confirmation") {
    return { acknowledged: workflow.acknowledged, review: workflow.review };
  }
  const context = publicationContext(workflow);
  if (context && context.result.classification !== "distinct") {
    return {
      acknowledged: "acknowledged" in workflow ? workflow.acknowledged : false,
      review: context,
    };
  }
  return null;
}

export function recipeDraftPublicationReducer(
  state: RecipeDraftPublicationState,
  event: RecipeDraftPublicationEvent,
): RecipeDraftPublicationState {
  switch (event.type) {
    case "validation-started":
      return {
        ...state,
        workflow: { phase: "validating", status: "reviewing" },
      };

    case "validation-failed":
      return { ...state, workflow: { status: "idle" } };

    case "preflight-started":
      return {
        attempts: { ...state.attempts, preflight: event.attempt },
        workflow: {
          phase: "checking",
          scope: event.scope,
          status: "reviewing",
        },
      };

    case "review-required": {
      const workflow = state.workflow;
      if (
        workflow.status !== "reviewing" ||
        workflow.phase !== "checking" ||
        state.attempts.preflight?.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      return {
        ...state,
        workflow: {
          acknowledged: false,
          review: { result: event.result, scope: workflow.scope },
          status: "confirmation",
        },
      };
    }

    case "acknowledgement-changed":
      if (state.workflow.status === "confirmation") {
        return {
          ...state,
          workflow: { ...state.workflow, acknowledged: event.acknowledged },
        };
      }
      if (state.workflow.status === "failed" && state.workflow.context) {
        return {
          ...state,
          workflow: { ...state.workflow, acknowledged: event.acknowledged },
        };
      }
      return state;

    case "publish-started":
      return {
        attempts: { ...state.attempts, publish: event.attempt },
        workflow: {
          acknowledged: event.context.decision === "continue",
          context: event.context,
          status: "publishing",
        },
      };

    case "published":
      if (
        state.workflow.status !== "publishing" ||
        state.attempts.publish?.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      return {
        ...state,
        workflow: {
          acknowledged: state.workflow.acknowledged,
          context: state.workflow.context,
          receipt: event.receipt,
          status: "published",
        },
      };

    case "operation-failed": {
      const activeAttempt =
        event.operation === "preflight"
          ? state.attempts.preflight
          : state.attempts.publish;
      const workflow = state.workflow;
      if (
        activeAttempt?.idempotencyKey !== event.attemptId ||
        (event.operation === "preflight" &&
          (workflow.status !== "reviewing" ||
            workflow.phase !== "checking")) ||
        (event.operation === "publish" && workflow.status !== "publishing")
      ) {
        return state;
      }
      const context =
        event.operation === "publish" &&
        !event.resetReview &&
        workflow.status === "publishing"
          ? workflow.context
          : null;
      const scope =
        workflow.status === "reviewing" && workflow.phase === "checking"
          ? workflow.scope
          : workflow.status === "publishing"
            ? workflow.context.scope
            : null;
      if (!scope) return state;
      const recovery: PublicationFailureRecovery =
        event.kind === "revision-conflict"
          ? "latest-draft"
          : event.kind === "source-unavailable"
            ? "source"
            : event.operation === "publish" && context !== null
              ? "publish"
              : "review";
      return {
        attempts: event.resetReview
          ? { preflight: null, publish: null }
          : state.attempts,
        workflow: {
          acknowledged:
            workflow.status === "publishing"
              ? workflow.acknowledged
              : context?.decision === "continue",
          context,
          message: event.message,
          operation: event.operation,
          recovery,
          scope,
          status: "failed",
          kind: event.kind,
        },
      };
    }

    case "confirmation-paused":
      if (event.context && event.context.result.classification !== "distinct") {
        return {
          ...state,
          workflow: {
            acknowledged: event.context.decision === "continue",
            review: event.context,
            status: "confirmation",
          },
        };
      }
      return {
        ...state,
        workflow: { status: "idle" },
      };

    case "keep-editing":
      return {
        attempts: { ...state.attempts, publish: null },
        workflow: { status: "idle" },
      };

    case "draft-changed":
      return {
        ...state,
        workflow: { status: "idle" },
      };
  }
}
