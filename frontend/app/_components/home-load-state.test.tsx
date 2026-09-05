import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  HomeLoadNotice,
  HomeLoadStateProvider,
  useHomeLoadIssue,
} from "./home-load-state";

function Issue({
  active = true,
  id,
  retry,
}: {
  active?: boolean;
  id: string;
  retry: () => void;
}) {
  useHomeLoadIssue({ active, id, retry });
  return null;
}

describe("homepage load recovery", () => {
  it("groups public and member failures into one notice and one retry action", async () => {
    const retryPublic = vi.fn();
    const retryMember = vi.fn();

    render(
      <HomeLoadStateProvider>
        <HomeLoadNotice />
        <Issue id="public" retry={retryPublic} />
        <Issue id="member" retry={retryMember} />
      </HomeLoadStateProvider>,
    );

    const notice = await screen.findByRole("status", {
      name: "Some homepage information couldn’t be updated.",
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(within(notice).getAllByRole("button", { name: "Try again" })).toHaveLength(
      1,
    );

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));

    expect(retryPublic).toHaveBeenCalledOnce();
    expect(retryMember).toHaveBeenCalledOnce();
  });

  it("removes the notice when the missing resource recovers", async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <HomeLoadStateProvider>
        <HomeLoadNotice />
        <Issue id="public" retry={retry} />
      </HomeLoadStateProvider>,
    );

    expect(
      await screen.findByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeVisible();

    rerender(
      <HomeLoadStateProvider>
        <HomeLoadNotice />
        <Issue active={false} id="public" retry={retry} />
      </HomeLoadStateProvider>,
    );

    expect(
      screen.queryByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeNull();
  });
});
