"use client";

import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useRef,
} from "react";

type WorkspaceTabMenuElement = "div" | "form" | "nav";

interface WorkspaceTabMenuProps extends HTMLAttributes<HTMLElement> {
  as?: WorkspaceTabMenuElement;
  itemsOnly?: boolean;
}

export function WorkspaceTabMenu({
  as: Component = "div",
  children,
  className,
  itemsOnly = false,
  ...props
}: WorkspaceTabMenuProps) {
  const classes = [
    "workspace-tab-menu",
    itemsOnly ? "workspace-tab-menu--items-only" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component {...props} className={classes}>
      {children}
    </Component>
  );
}

interface WorkspaceTabItemsProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "nav";
}

export function WorkspaceTabItems({
  as: Component = "div",
  children,
  className,
  ...props
}: WorkspaceTabItemsProps) {
  return (
    <Component
      {...props}
      className={["workspace-tab-menu__items", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Component>
  );
}

export function WorkspaceTabCount({
  children,
  className,
  hidden = true,
}: {
  children: ReactNode;
  className?: string;
  hidden?: boolean;
}) {
  return (
    <span
      className={["workspace-tab-menu__count", className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={hidden || undefined}
    >
      {children}
    </span>
  );
}

interface WorkspaceTabButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active: boolean;
  count?: number | null;
  countClassName?: string;
  countHidden?: boolean;
  selection?: "pressed" | "selected";
}

export const WorkspaceTabButton = forwardRef<
  HTMLButtonElement,
  WorkspaceTabButtonProps
>(function WorkspaceTabButton(
  {
    active,
    children,
    className,
    count,
    countClassName,
    countHidden = true,
    selection = "pressed",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={["workspace-tab-menu__item", className]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={selection === "pressed" ? active : undefined}
      aria-selected={selection === "selected" ? active : undefined}
    >
      {children}
      {count !== null && count !== undefined ? (
        <WorkspaceTabCount className={countClassName} hidden={countHidden}>
          {count}
        </WorkspaceTabCount>
      ) : null}
    </button>
  );
});

export interface WorkspaceTabDefinition<Value extends string> {
  className?: string;
  count?: number | null;
  countClassName?: string;
  countHidden?: boolean;
  id: string;
  label: ReactNode;
  panelId: string;
  value: Value;
}

interface WorkspaceTabsProps<Value extends string> {
  ariaLabel: string;
  className?: string;
  items: readonly WorkspaceTabDefinition<Value>[];
  onChange: (value: Value) => void;
  value: Value;
}

export function WorkspaceTabs<Value extends string>({
  ariaLabel,
  className,
  items,
  onChange,
  value,
}: WorkspaceTabsProps<Value>) {
  const tabRefs = useRef(new Map<Value, HTMLButtonElement>());

  function selectFromKeyboard(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentValue: Value,
  ) {
    const currentIndex = items.findIndex((item) => item.value === currentValue);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.value);
    tabRefs.current.get(nextItem.value)?.focus();
  }

  return (
    <WorkspaceTabMenu
      className={className}
      itemsOnly
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <WorkspaceTabButton
          key={item.value}
          ref={(node) => {
            if (node) tabRefs.current.set(item.value, node);
            else tabRefs.current.delete(item.value);
          }}
          id={item.id}
          className={item.className}
          type="button"
          role="tab"
          active={value === item.value}
          count={item.count}
          countClassName={item.countClassName}
          countHidden={item.countHidden}
          selection="selected"
          aria-controls={item.panelId}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => selectFromKeyboard(event, item.value)}
        >
          {item.label}
        </WorkspaceTabButton>
      ))}
    </WorkspaceTabMenu>
  );
}
