"use client";

import { useEffect, useState } from "react";

import {
  relativeTimeLabel,
  type RelativeTimeLabel,
} from "../../../shared/time/relative-time";

interface RecipePublicationTimeProps {
  className: string;
  initialPublication: RelativeTimeLabel;
  value: string;
}

export function RecipePublicationTime({
  className,
  initialPublication,
  value,
}: RecipePublicationTimeProps) {
  const [publication, setPublication] = useState<RelativeTimeLabel | null>(
    initialPublication,
  );

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      setPublication(relativeTimeLabel(value));
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [value]);

  if (publication === null) return null;

  return (
    <time
      className={className}
      dateTime={value}
      title={publication.absoluteLabel}
    >
      Published {publication.relativeLabel}
    </time>
  );
}
