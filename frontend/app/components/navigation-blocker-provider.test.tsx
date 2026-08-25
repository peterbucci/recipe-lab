import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NavigationBlockerProvider,
  useNavigationBlocker,
} from "./navigation-blocker-provider";

function Harness() {
  const { setBlocked } = useNavigationBlocker();
  return <button type="button" onClick={() => setBlocked(true)}>Make dirty</button>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NavigationBlockerProvider", () => {
  it("warns for unload and restores the history sentinel when Back is cancelled", async () => {
    const pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<NavigationBlockerProvider><Harness /></NavigationBlockerProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    await waitFor(() => expect(pushState).toHaveBeenCalled());
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    fireEvent.popState(window);
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved recipe changes. Leave without saving them?",
    );
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("continues to the real previous entry after Back is confirmed", async () => {
    vi.spyOn(window.history, "pushState").mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NavigationBlockerProvider><Harness /></NavigationBlockerProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Make dirty" }));
    fireEvent.popState(window);
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });
});
