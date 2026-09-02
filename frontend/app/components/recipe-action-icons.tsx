import { GitFork, Heart, Star } from "lucide-react";

interface ToggleIconProps {
  filled?: boolean;
}

export function StarIcon({ filled = false }: ToggleIconProps) {
  return (
    <Star
      aria-hidden="true"
      data-icon="star"
      fill={filled ? "currentColor" : "none"}
    />
  );
}

export function HeartIcon({ filled = false }: ToggleIconProps) {
  return (
    <Heart
      aria-hidden="true"
      data-icon="heart"
      fill={filled ? "currentColor" : "none"}
    />
  );
}

export function BranchIcon() {
  return (
    <GitFork
      aria-hidden="true"
      data-icon="branch"
    />
  );
}
