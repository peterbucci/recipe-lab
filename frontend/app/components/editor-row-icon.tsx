import { ChevronDown, ChevronUp, EllipsisVertical, Minus } from "lucide-react";

export function EditorRowIcon({
  kind,
}: {
  kind: "up" | "down" | "menu" | "remove";
}) {
  const Icon = {
    up: ChevronUp,
    down: ChevronDown,
    menu: EllipsisVertical,
    remove: Minus,
  }[kind];

  return <Icon aria-hidden="true" data-icon={kind} />;
}
