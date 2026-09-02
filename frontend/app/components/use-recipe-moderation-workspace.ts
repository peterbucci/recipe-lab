import { type RefObject, useEffect, useRef, useState } from "react";

import { isAbortError } from "../../lib/abort-error";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  browseRecipeModerationCases,
  fetchRecipeModerationCase,
  moderateRecipeCase,
  type RecipeModerationAction,
  RecipeModerationApiError,
  type RecipeModerationCaseDetail,
  type RecipeModerationCasePage,
  type RecipeModerationStatus,
} from "../../lib/recipe-moderation-api";

interface Attempt {
  fingerprint: string;
  idempotencyKey: string;
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

export function formatModerationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
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
  const [actionPending, setActionPending] = useState<RecipeModerationAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const actionAttempt = useRef<Attempt | null>(null);

  function selectCase(recipeVersionId: string | null) {
    selectedIdRef.current = recipeVersionId;
    setSelectedId(recipeVersionId);
    setDetail(null);
    setDetailLoading(recipeVersionId !== null);
    setDetailError("");
    setPrivateNote("");
    setActionError("");
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
        if (isAbortError(reason)) return;
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
        setDetail(result);
        setDetailError("");
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) return;
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
    if (!selectedId || actionPending) return;
    const note = privateNote.trim() || null;
    const fingerprint = JSON.stringify({ selectedId, action, note });
    if (actionAttempt.current?.fingerprint !== fingerprint) {
      actionAttempt.current = { fingerprint, idempotencyKey: createIdempotencyKey() };
    }
    setActionPending(action);
    setActionError("");
    setWorkspaceStatus("");
    try {
      const result = await moderateRecipeCase(
        selectedId,
        action,
        note,
        actionAttempt.current.idempotencyKey,
      );
      setPrivateNote("");
      actionAttempt.current = null;
      setWorkspaceStatus(
        `${action === "hide" ? "Recipe hidden" : action === "restore" ? "Recipe restored" : "Case resolved"}. The moderation record was updated.`,
      );
      setDetail((current) =>
        current
          ? { ...current, status: result.case_status, visibility_state: result.visibility_state }
          : current,
      );
      setQueueReload((value) => value + 1);
      setDetailReload((value) => value + 1);
      window.setTimeout(() => statusRef.current?.focus(), 0);
    } catch (reason) {
      if (reason instanceof RecipeModerationApiError && reason.status === 403) {
        onAuthorizationLost();
        return;
      }
      const message =
        reason instanceof RecipeModerationApiError && reason.status === 409
          ? "This case changed before your action completed. Your private note is still here; reload the case and review its current state."
          : reason instanceof RecipeModerationApiError
            ? reason.message
            : "Recipe Lab could not complete this moderation action. Please try again.";
      setActionError(message);
      window.setTimeout(() => actionErrorRef.current?.focus(), 0);
    } finally {
      setActionPending(null);
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
