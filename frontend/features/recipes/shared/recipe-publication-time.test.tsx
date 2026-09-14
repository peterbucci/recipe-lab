import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { relativeTimeLabel } from "../../../shared/time/relative-time";
import { RecipePublicationTime } from "./recipe-publication-time";

const PUBLISHED_AT = "2026-08-26T12:00:00.000Z";

describe("RecipePublicationTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconciles a server label with the browser clock after hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-27T12:00:00.000Z");
    const serverPublication = relativeTimeLabel(
      PUBLISHED_AT,
      Date.parse("2026-09-14T12:00:00.000Z"),
    );
    expect(serverPublication).not.toBeNull();

    render(
      <RecipePublicationTime
        className="published"
        initialPublication={serverPublication!}
        value={PUBLISHED_AT}
      />,
    );
    act(() => vi.runAllTimers());

    expect(screen.getByText("Published yesterday")).toHaveAttribute(
      "datetime",
      PUBLISHED_AT,
    );
  });
});
