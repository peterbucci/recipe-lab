"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { useRovingTabs } from "../../../shared/ui/use-roving-tabs";

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

  const { getTabProps } = useRovingTabs({
    onChange: selectTab,
    value: activeTab,
    values: tabs.map((tab) => tab.id),
  });

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
            {...getTabProps(tab.id)}
            key={tab.id}
            className="recipe-detail__section-tab"
            id={`recipe-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`recipe-panel-${tab.id}`}
            onClick={() => selectTab(tab.id)}
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
