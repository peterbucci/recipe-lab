export interface RelativeTimeLabel {
  absoluteLabel: string;
  relativeLabel: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

export function relativeTimeLabel(
  value: string,
  now = Date.now(),
): RelativeTimeLabel | null {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;

  const absoluteLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  const secondsFromNow = (date.valueOf() - now) / 1_000;
  const absoluteSeconds = Math.abs(secondsFromNow);

  if (absoluteSeconds < 60) {
    return {
      absoluteLabel,
      relativeLabel: secondsFromNow <= 0 ? "just now" : "in less than a minute",
    };
  }

  let unit: "minute" | "hour" | "day" | "month" | "year";
  let unitSeconds: number;
  if (absoluteSeconds < 3_600) {
    unit = "minute";
    unitSeconds = 60;
  } else if (absoluteSeconds < 86_400) {
    unit = "hour";
    unitSeconds = 3_600;
  } else if (absoluteSeconds < 2_629_800) {
    unit = "day";
    unitSeconds = 86_400;
  } else if (absoluteSeconds < 31_557_600) {
    unit = "month";
    unitSeconds = 2_629_800;
  } else {
    unit = "year";
    unitSeconds = 31_557_600;
  }

  return {
    absoluteLabel,
    relativeLabel: relativeTimeFormatter.format(
      Math.round(secondsFromNow / unitSeconds),
      unit,
    ),
  };
}
