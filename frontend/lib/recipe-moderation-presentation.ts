import type { RecipeModerationStatus } from "./recipe-moderation-api";

export const RECIPE_MODERATION_STATUS_LABELS: Record<
  RecipeModerationStatus,
  string
> = {
  open: "Open",
  resolved: "Resolved",
};

export function formatModerationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
