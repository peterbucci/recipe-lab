"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";
import { MemberRouteGate } from "./member-route-gate";
import { MissingIngredientRequestPanel } from "./missing-ingredient-request-panel";

const RETURN_TO = "/account/ingredient-requests";
const REQUEST_MODAL_ID_PREFIX = "account-new-ingredient-request";

function MyIngredientRequestsWorkspaceInner() {
  const requestButtonRef = useRef<HTMLButtonElement>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);

  function returnFocusToRequestButton() {
    window.setTimeout(() => requestButtonRef.current?.focus(), 0);
  }

  function closeRequestDialog() {
    setRequestOpen(false);
    returnFocusToRequestButton();
  }

  return (
    <main
      id="main-content"
      className="page-shell account-workspace-page account-ingredient-requests-page member-request-page"
    >
      <header className="page-intro member-request-page__intro">
        <div>
          <h1>Ingredient Requests</h1>
          <p>Track ingredients you&apos;ve asked Recipe Lab to add to the catalog.</p>
        </div>
        <button
          ref={requestButtonRef}
          aria-label="Request an ingredient"
          aria-controls={`${REQUEST_MODAL_ID_PREFIX}-request-dialog`}
          aria-expanded={requestOpen}
          aria-haspopup="dialog"
          className="button button--primary member-request-page__create"
          type="button"
          onClick={() => setRequestOpen(true)}
        >
          <Plus
            aria-hidden="true"
            className="member-request-page__create-icon"
          />
          <span>Request an ingredient</span>
        </button>
      </header>
      <MemberIngredientRequestHistory
        key={historyRevision}
        idPrefix="account-ingredient-requests"
        onRequestIngredient={() => setRequestOpen(true)}
      />
      {requestOpen ? (
        <MissingIngredientRequestPanel
          idPrefix={REQUEST_MODAL_ID_PREFIX}
          initialName=""
          onClose={closeRequestDialog}
          onSubmitted={() => {
            setRequestOpen(false);
            setHistoryRevision((revision) => revision + 1);
            returnFocusToRequestButton();
          }}
        />
      ) : null}
    </main>
  );
}

export function MyIngredientRequestsWorkspace() {
  return (
    <MemberRouteGate
      eyebrow="Ingredient requests"
      pageClassName="account-workspace-page account-ingredient-requests-page"
      returnTo={RETURN_TO}
      title="Ingredient Requests"
    >
      <MyIngredientRequestsWorkspaceInner />
    </MemberRouteGate>
  );
}
