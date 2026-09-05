"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";

export type FloatingPanelPlacement = "above" | "below";

interface FloatingPanelLayout {
  availableHeight: number | null;
  placement: FloatingPanelPlacement;
}

interface UseFloatingPanelPlacementOptions<
  TTrigger extends HTMLElement,
  TPanel extends HTMLElement,
> {
  contentKey?: unknown;
  open: boolean;
  panelRef: RefObject<TPanel | null>;
  triggerRef: RefObject<TTrigger | null>;
}

type FloatingPanelStyle = CSSProperties & {
  "--floating-panel-max-height": string;
};

const VIEWPORT_EDGE_GAP = 16;
const TRIGGER_GAP = 6;

export function resolveFloatingPanelPlacement({
  panelHeight,
  triggerBottom,
  triggerTop,
  viewportHeight,
}: {
  panelHeight: number;
  triggerBottom: number;
  triggerTop: number;
  viewportHeight: number;
}): Required<FloatingPanelLayout> {
  const availableBelow = Math.max(
    0,
    viewportHeight - VIEWPORT_EDGE_GAP - triggerBottom - TRIGGER_GAP,
  );
  const availableAbove = Math.max(
    0,
    triggerTop - VIEWPORT_EDGE_GAP - TRIGGER_GAP,
  );
  const maximumPanelHeight = Math.max(
    0,
    viewportHeight - VIEWPORT_EDGE_GAP * 2,
  );
  const requiredHeight = Math.min(panelHeight, maximumPanelHeight);
  const placement: FloatingPanelPlacement =
    requiredHeight <= availableBelow
      ? "below"
      : requiredHeight <= availableAbove || availableAbove > availableBelow
        ? "above"
        : "below";

  return {
    placement,
    availableHeight: placement === "above" ? availableAbove : availableBelow,
  };
}

export function useFloatingPanelPlacement<
  TTrigger extends HTMLElement,
  TPanel extends HTMLElement,
>({
  contentKey,
  open,
  panelRef,
  triggerRef,
}: UseFloatingPanelPlacementOptions<TTrigger, TPanel>) {
  const [layout, setLayout] = useState<FloatingPanelLayout>({
    availableHeight: null,
    placement: "below",
  });

  const updatePlacement = useCallback(() => {
    if (!open || !panelRef.current || !triggerRef.current) {
      return;
    }
    const panel = panelRef.current;
    const triggerBounds = triggerRef.current.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const nextLayout = resolveFloatingPanelPlacement({
      panelHeight: Math.max(panel.scrollHeight, panelBounds.height),
      triggerBottom: triggerBounds.bottom,
      triggerTop: triggerBounds.top,
      viewportHeight: window.innerHeight,
    });
    setLayout((current) =>
      current.placement === nextLayout.placement &&
      current.availableHeight === nextLayout.availableHeight
        ? current
        : nextLayout,
    );
  }, [open, panelRef, triggerRef]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePlacement();

    const panel = panelRef.current;
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updatePlacement)
        : null;
    if (panel) {
      observer?.observe(panel);
    }
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [contentKey, open, panelRef, updatePlacement]);

  const style: FloatingPanelStyle | undefined =
    layout.availableHeight === null
      ? undefined
      : {
          "--floating-panel-max-height": `${Math.floor(layout.availableHeight)}px`,
        };

  return {
    placement: layout.placement,
    style,
  };
}
