"use client";

import {
  type ButtonHTMLAttributes,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { useRovingTabs } from "./use-roving-tabs";

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
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={["workspace-tab-menu__count", className]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
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
        <WorkspaceTabCount className={countClassName}>
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
  const { getTabProps } = useRovingTabs({
    onChange,
    value,
    values: items.map((item) => item.value),
  });

  return (
    <WorkspaceTabMenu
      className={className}
      itemsOnly
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const tabProps = getTabProps(item.value);
        return (
          <WorkspaceTabButton
            {...tabProps}
            key={item.value}
            id={item.id}
            className={item.className}
            type="button"
            role="tab"
            active={tabProps["aria-selected"]}
            count={item.count}
            countClassName={item.countClassName}
            selection="selected"
            aria-controls={item.panelId}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </WorkspaceTabButton>
        );
      })}
    </WorkspaceTabMenu>
  );
}
