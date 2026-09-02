import { describe, expect, it } from "vitest";

import {
  communityPublicationTimeLabel,
  relativeTimeLabel,
} from "./relative-time";

const NOW = Date.parse("2026-08-30T12:00:00Z");

describe("relative time presentation", () => {
  it("keeps natural recipe-detail labels with an absolute date and time", () => {
    const label = relativeTimeLabel("2026-08-29T12:00:00Z", NOW);

    expect(label?.relativeLabel).toBe("yesterday");
    expect(label?.absoluteLabel).toMatch(/Aug 29, 2026/);
    expect(label?.absoluteLabel).toMatch(/12:00 PM/);
  });

  it("keeps numeric community labels with a date-only absolute label", () => {
    const label = communityPublicationTimeLabel(
      "2026-08-29T12:00:00Z",
      NOW,
    );

    expect(label).toEqual({
      absoluteLabel: "Aug 29, 2026",
      relativeLabel: "1 day ago",
    });
  });

  it("omits invalid timestamps", () => {
    expect(relativeTimeLabel("not-a-date", NOW)).toBeNull();
    expect(communityPublicationTimeLabel("not-a-date", NOW)).toBeNull();
  });
});
