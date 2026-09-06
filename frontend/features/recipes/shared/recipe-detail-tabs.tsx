"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type RecipeDetailTab = "recipe" | "notes" | "family";

interface RecipeDetailTabsProps {
  family: ReactNode;
  notes: ReactNode;
  recipe: ReactNode;
}

const tabs: readonly { id: RecipeDetailTab; label: string }[] = [
  { id: "recipe", label: "Recipe" },
  { id: "notes", label: "Notes" },
  { id: "family", label: "Family" },
];

function tabFromHash(hash: string): RecipeDetailTab | null {
  if (hash === "#recipe-family") return "family";
  if (hash === "#recipe-notes") return "notes";
  if (hash === "#ingredients" || hash === "#instructions") return "recipe";
  return null;
}

export function RecipeDetailTabs({
  family,
  notes,
  recipe,
}: RecipeDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<RecipeDetailTab>("recipe");
  const tabRefs = useRef(new Map<RecipeDetailTab, HTMLButtonElement>());

  useEffect(() => {
    function selectHashTab() {
      const nextTab = tabFromHash(window.location.hash);
      if (nextTab !== null) setActiveTab(nextTab);
    }

    selectHashTab();
    window.addEventListener("hashchange", selectHashTab);
    return () => window.removeEventListener("hashchange", selectHashTab);
  }, []);

  function selectTab(tab: RecipeDetailTab) {
    setActiveTab(tab);
    const hash = tab === "recipe" ? "#ingredients" : `#recipe-${tab}`;
    window.history.replaceState(null, "", hash);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    tab: RecipeDetailTab,
  ) {
    const currentIndex = tabs.findIndex((item) => item.id === tab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex].id;
    selectTab(nextTab);
    tabRefs.current.get(nextTab)?.focus();
  }

  const content: Record<RecipeDetailTab, ReactNode> = { family, notes, recipe };

  return (
    <div className="recipe-detail__tabs">
      <div
        className="recipe-detail__section-nav"
        role="tablist"
        aria-label="Recipe sections"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.id, element);
              else tabRefs.current.delete(tab.id);
            }}
            className="recipe-detail__section-tab"
            id={`recipe-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`recipe-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="recipe-detail__tab-panel"
          id={`recipe-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`recipe-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
        >
          {content[tab.id]}
        </div>
      ))}
    </div>
  );
}
