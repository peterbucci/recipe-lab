"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  forwardRef,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    (ref as MutableRefObject<T | null>).current = value;
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

interface PopoverContextValue {
  closeOnFocusOutside: boolean;
  dismissible: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  setContent: (node: HTMLDivElement | null) => void;
  setTrigger: (node: HTMLButtonElement | null) => void;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(): PopoverContextValue {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error("PopoverTrigger and PopoverContent must be rendered inside Popover.");
  }
  return context;
}

interface PopoverProps {
  children: ReactNode;
  closeOnFocusOutside?: boolean;
  dismissible?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function Popover({
  children,
  closeOnFocusOutside = false,
  dismissible = true,
  onOpenChange,
  open,
}: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dismissible) return;

    function isInsidePopover(target: EventTarget | null) {
      return (
        target instanceof Node &&
        (triggerRef.current?.contains(target) || contentRef.current?.contains(target))
      );
    }

    function closeFromOutsidePointer(event: PointerEvent) {
      if (!isInsidePopover(event.target)) onOpenChange(false);
    }

    function closeFromOutsideFocus(event: FocusEvent) {
      if (closeOnFocusOutside && !isInsidePopover(event.target)) {
        onOpenChange(false);
      }
    }

    function closeFromEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = triggerRef.current;
      onOpenChange(false);
      trigger?.focus();
    }

    document.addEventListener("pointerdown", closeFromOutsidePointer, true);
    document.addEventListener("focusin", closeFromOutsideFocus);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutsidePointer, true);
      document.removeEventListener("focusin", closeFromOutsideFocus);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [closeOnFocusOutside, dismissible, onOpenChange, open]);

  return (
    <PopoverContext.Provider
      value={{
        closeOnFocusOutside,
        dismissible,
        onOpenChange,
        open,
        setContent: (node) => {
          contentRef.current = node;
        },
        setTrigger: (node) => {
          triggerRef.current = node;
        },
      }}
    >
      {children}
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  contentId: string;
}

export const PopoverTrigger = forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  function PopoverTrigger(
    { contentId, onClick, type = "button", ...props },
    forwardedRef,
  ) {
    const context = usePopoverContext();
    return (
      <button
        {...props}
        ref={(node) => {
          context.setTrigger(node);
          assignRef(forwardedRef, node);
        }}
        type={type}
        aria-controls={contentId}
        aria-expanded={context.open}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.onOpenChange(!context.open);
        }}
      />
    );
  },
);

interface PopoverContentProps extends HTMLAttributes<HTMLDivElement> {
  initialFocus?: "content" | "first" | false;
}

export const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent(
    {
      children,
      initialFocus = false,
      onKeyDown,
      role = "dialog",
      tabIndex,
      ...props
    },
    forwardedRef,
  ) {
    const context = usePopoverContext();
    const localContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!context.open || !initialFocus) return;
      const content = localContentRef.current;
      if (!content) return;
      const target =
        initialFocus === "first" ? focusableElements(content)[0] : content;
      target?.focus();
    }, [context.open, initialFocus]);

    if (!context.open) return null;

    return (
      <div
        {...props}
        ref={(node) => {
          localContentRef.current = node;
          context.setContent(node);
          assignRef(forwardedRef, node);
        }}
        role={role}
        tabIndex={tabIndex ?? (initialFocus === "content" ? -1 : undefined)}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    );
  },
);

const subscribeToClient = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  backdropClassName: string;
  dismissible?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  {
    backdropClassName,
    children,
    dismissible = true,
    initialFocusRef,
    onKeyDown,
    onOpenChange,
    open,
    restoreFocusRef,
    ...props
  },
  forwardedRef,
) {
  const contentRef = useRef<HTMLDivElement>(null);
  const activeBeforeOpenRef = useRef<HTMLElement | null>(null);
  const portalReady = useSyncExternalStore(
    subscribeToClient,
    clientSnapshot,
    serverSnapshot,
  );

  useEffect(() => {
    if (!open || !portalReady) return;
    activeBeforeOpenRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const explicitReturnTarget = restoreFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const content = contentRef.current;
    const initialTarget =
      initialFocusRef?.current ??
      content?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
      (content ? focusableElements(content)[0] : null) ??
      content;
    initialTarget?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      const returnTarget = explicitReturnTarget ?? activeBeforeOpenRef.current;
      returnTarget?.focus();
    };
  }, [initialFocusRef, open, portalReady, restoreFocusRef]);

  if (!open || !portalReady || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={backdropClassName}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div
        {...props}
        ref={(node) => {
          contentRef.current = node;
          assignRef(forwardedRef, node);
        }}
        role="dialog"
        aria-modal="true"
        tabIndex={props.tabIndex ?? -1}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            if (dismissible) {
              event.preventDefault();
              onOpenChange(false);
            }
            return;
          }
          if (event.key !== "Tab") return;

          const focusable = focusableElements(event.currentTarget);
          if (focusable.length === 0) {
            event.preventDefault();
            event.currentTarget.focus();
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
});
