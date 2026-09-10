import { type RefObject, useEffect, useRef, useState } from "react";

import { isAbortError } from "../../../shared/api/abort-error";
import { createIdempotencyKey } from "../../../shared/api/idempotency-key";
import {
  browseRecipeModerationCases,
  fetchRecipeModerationCase,
  moderateRecipeCase,
  type RecipeModerationAction,
  RecipeModerationApiError,
  type RecipeModerationCaseDetail,
  type RecipeModerationCasePage,
  type RecipeModerationStatus,
} from "./recipe-moderation-api";

interface Attempt {
  caseId: string;
  fingerprint: string;
  idempotencyKey: string;
}

interface PendingAction {
  action: RecipeModerationAction;
  attempt: Attempt;
  detailGeneration: number;
  note: string | null;
}

export interface RecipeModerationWorkspaceState {
  actionError: string;
  actionErrorRef: RefObject<HTMLDivElement | null>;
  actionPending: RecipeModerationAction | null;
  caseStatus: RecipeModerationStatus;
  detail: RecipeModerationCaseDetail | null;
  detailError: string;
  detailLoading: boolean;
  page: number;
  privateNote: string;
  queue: RecipeModerationCasePage | null;
  queueError: string;
  queueLoading: boolean;
  selectedId: string | null;
  statusRef: RefObject<HTMLParagraphElement | null>;
  workspaceStatus: string;
  applyAction: (action: RecipeModerationAction) => Promise<void>;
  changeCaseStatus: (status: RecipeModerationStatus) => void;
  changePrivateNote: (value: string) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  reloadDetail: () => void;
  reloadQueue: () => void;
  selectCase: (recipeVersionId: string | null) => void;
}

export function useRecipeModerationWorkspace({
  onAuthorizationLost,
}: {
  onAuthorizationLost: () => void;
}): RecipeModerationWorkspaceState {
  const [caseStatus, setCaseStatus] = useState<RecipeModerationStatus>("open");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<RecipeModerationCasePage | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [queueReload, setQueueReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<RecipeModerationCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailReload, setDetailReload] = useState(0);
  const [privateNote, setPrivateNote] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const actionAttempt = useRef<Attempt | null>(null);
  const detailGenerationRef = useRef(0);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const focusOwnerRef = useRef<PendingAction | null>(null);
  const actionPending = pendingAction?.action ?? null;

  function ownsDetailGeneration(operation: PendingAction) {
    return (
      selectedIdRef.current === operation.attempt.caseId &&
      detailGenerationRef.current === operation.detailGeneration
    );
  }

  function ownsPendingAction(operation: PendingAction) {
    return (
      pendingActionRef.current === operation &&
      actionAttempt.current === operation.attempt &&
      ownsDetailGeneration(operation)
    );
  }

  function scheduleOwnedFocus(
    operation: PendingAction,
    target: RefObject<HTMLElement | null>,
  ) {
    focusOwnerRef.current = operation;
    window.setTimeout(() => {
      if (
        focusOwnerRef.current === operation &&
        ownsDetailGeneration(operation)
      ) {
        target.current?.focus();
      }
    }, 0);
  }

  function selectCase(recipeVersionId: string | null) {
    if (selectedIdRef.current === recipeVersionId) return;
    detailGenerationRef.current += 1;
    selectedIdRef.current = recipeVersionId;
    pendingActionRef.current = null;
    focusOwnerRef.current = null;
    setSelectedId(recipeVersionId);
    setDetail(null);
    setDetailLoading(recipeVersionId !== null);
    setDetailError("");
    setPrivateNote("");
    setPendingAction(null);
    setActionError("");
    setWorkspaceStatus("");
    actionAttempt.current = null;
  }

  function reloadQueue() {
    setQueueLoading(true);
    setQueueError("");
    setQueueReload((value) => value + 1);
  }

  function reloadDetail() {
    if (selectedId) setDetailLoading(true);
    setDetailError("");
    setDetailReload((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    void browseRecipeModerationCases({
      status: caseStatus,
      page,
      pageSize: 20,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setQueue(result);
        setQueueError("");
        const current = selectedIdRef.current;
        const next =
          current && result.items.some((item) => item.recipe_version_id === current)
            ? current
            : (result.items[0]?.recipe_version_id ?? null);
        if (next !== current) selectCase(next);
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason) || controller.signal.aborted) return;
        setQueue(null);
        selectCase(null);
        if (reason instanceof RecipeModerationApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setQueueError("The recipe-report queue could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [caseStatus, onAuthorizationLost, page, queueReload]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void fetchRecipeModerationCase(selectedId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDetail(result);
        setDetailError("");
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason) || controller.signal.aborted) return;
        if (reason instanceof RecipeModerationApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setDetailError("This moderation case could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailReload, onAuthorizationLost, selectedId]);

  async function applyAction(action: RecipeModerationAction) {
    const caseId = selectedId;
    if (
      !caseId ||
      selectedIdRef.current !== caseId ||
      pendingActionRef.current
    ) {
      return;
    }
    const note = privateNote.trim() || null;
    const fingerprint = JSON.stringify({ caseId, action, note });
    if (actionAttempt.current?.fingerprint !== fingerprint) {
      actionAttempt.current = {
        caseId,
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    const operation: PendingAction = {
      action,
      attempt: actionAttempt.current,
      detailGeneration: detailGenerationRef.current,
      note,
    };
    pendingActionRef.current = operation;
    focusOwnerRef.current = null;
    setPendingAction(operation);
    setActionError("");
    setWorkspaceStatus("");
    try {
      const result = await moderateRecipeCase(
        operation.attempt.caseId,
        operation.action,
        operation.note,
        operation.attempt.idempotencyKey,
      );
      setQueueReload((value) => value + 1);
      if (ownsPendingAction(operation)) {
        setPrivateNote("");
        actionAttempt.current = null;
        setWorkspaceStatus(
          `${action === "hide" ? "Recipe hidden" : action === "restore" ? "Recipe restored" : "Case resolved"}. The moderation record was updated.`,
        );
        setDetail((current) =>
          current?.recipe_version_id === operation.attempt.caseId
            ? {
                ...current,
                status: result.case_status,
                visibility_state: result.visibility_state,
              }
            : current,
        );
        setDetailReload((value) => value + 1);
        scheduleOwnedFocus(operation, statusRef);
      }
    } catch (reason) {
      if (reason instanceof RecipeModerationApiError && reason.status === 403) {
        onAuthorizationLost();
        return;
      }
      if (!ownsPendingAction(operation)) return;
      const message =
        reason instanceof RecipeModerationApiError && reason.status === 409
          ? "This case changed before your action completed. Your private note is still here; reload the case and review its current state."
          : reason instanceof RecipeModerationApiError
            ? reason.message
            : "Recipe Lab could not complete this moderation action. Please try again.";
      setActionError(message);
      scheduleOwnedFocus(operation, actionErrorRef);
    } finally {
      if (pendingActionRef.current === operation) {
        pendingActionRef.current = null;
        setPendingAction((current) =>
          current === operation ? null : current,
        );
      }
    }
  }

  function changeCaseStatus(status: RecipeModerationStatus) {
    setQueueLoading(true);
    setQueueError("");
    setCaseStatus(status);
    setPage(1);
    selectCase(null);
  }

  function changePrivateNote(value: string) {
    focusOwnerRef.current = null;
    setPrivateNote(value);
    setActionError("");
  }

  function goToPreviousPage() {
    setQueueLoading(true);
    setQueueError("");
    setPage((value) => Math.max(1, value - 1));
  }

  function goToNextPage() {
    setQueueLoading(true);
    setQueueError("");
    setPage((value) => value + 1);
  }

  return {
    actionError,
    actionErrorRef,
    actionPending,
    applyAction,
    caseStatus,
    changeCaseStatus,
    changePrivateNote,
    detail,
    detailError,
    detailLoading,
    goToNextPage,
    goToPreviousPage,
    page,
    privateNote,
    queue,
    queueError,
    queueLoading,
    reloadDetail,
    reloadQueue,
    selectCase,
    selectedId,
    statusRef,
    workspaceStatus,
  };
}
