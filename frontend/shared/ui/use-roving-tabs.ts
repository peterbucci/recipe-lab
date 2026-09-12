"use client";

import {
  type KeyboardEventHandler,
  type RefCallback,
  useRef,
} from "react";

interface UseRovingTabsOptions<Value extends string> {
  onChange: (value: Value) => void;
  value: Value;
  values: readonly Value[];
}

interface RovingTabProps {
  "aria-selected": boolean;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  ref: RefCallback<HTMLButtonElement>;
  tabIndex: 0 | -1;
}

/**
 * Supplies the interaction contract for an automatically activated tablist.
 * Markup, ids, panel ownership, and styling stay with the consuming feature.
 */
export function useRovingTabs<Value extends string>({
  onChange,
  value,
  values,
}: UseRovingTabsOptions<Value>) {
  const tabRefs = useRef(new Map<Value, HTMLButtonElement>());

  function getTabProps(candidate: Value): RovingTabProps {
    return {
      "aria-selected": candidate === value,
      onKeyDown: (event) => {
        const currentIndex = values.indexOf(candidate);
        if (currentIndex < 0 || values.length === 0) return;

        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % values.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + values.length) % values.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = values.length - 1;
        }

        if (nextIndex === null) return;

        const nextValue = values[nextIndex];
        if (nextValue === undefined) return;

        event.preventDefault();
        onChange(nextValue);
        tabRefs.current.get(nextValue)?.focus();
      },
      ref: (node) => {
        if (node) tabRefs.current.set(candidate, node);
        else tabRefs.current.delete(candidate);
      },
      tabIndex: candidate === value ? 0 : -1,
    };
  }

  return { getTabProps };
}
