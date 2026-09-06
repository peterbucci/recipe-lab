import { describe, expect, it } from "vitest";

import { formatModerationTime } from "./recipe-moderation-presentation";

describe("recipe moderation date presentation", () => {
  it("formats a valid timestamp", () => {
    expect(formatModerationTime("2026-08-24T18:00:00Z")).not.toBe(
      "2026-08-24T18:00:00Z",
    );
  });

  it("renders an invalid timestamp safely", () => {
    expect(formatModerationTime("date unavailable")).toBe("date unavailable");
  });
});
