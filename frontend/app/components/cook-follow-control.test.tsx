import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchCookFollowState,
  setCookFollowing,
  type CookFollowState,
} from "../../lib/member-follow-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { CookFollowControl } from "./cook-follow-control";

const mocks = vi.hoisted(() => ({
  fetchCookFollowState: vi.fn(),
  setCookFollowing: vi.fn(),
}));

vi.mock("../../lib/member-follow-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-follow-api")>();
  return {
    ...actual,
    fetchCookFollowState: mocks.fetchCookFollowState,
    setCookFollowing: mocks.setCookFollowing,
  };
});

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

const control = (
  <CookFollowControl
    cookId={COOK_ID}
    displayName="Alice Cook"
    handle="alice-cook"
    initialFollowerCount={7}
  />
);

function renderForUser(userId: string) {
  return render(
    <AuthSessionProvider
      initialSession={{
        status: "authenticated",
        user: {
          id: userId,
          display_name: userId === COOK_ID ? "Alice Cook" : "Bob Cook",
          handle: userId === COOK_ID ? "alice-cook" : "bob-cook",
        },
      }}
    >
      {control}
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  mocks.fetchCookFollowState.mockReset();
  mocks.setCookFollowing.mockReset();
  mocks.fetchCookFollowState.mockResolvedValue({
    cook_id: COOK_ID,
    following: false,
    follower_count: 7,
  });
});

describe("CookFollowControl", () => {
  it("shows one stable loading button while the private follow state resolves", async () => {
    mocks.fetchCookFollowState.mockReturnValue(
      new Promise<CookFollowState>(() => undefined),
    );

    renderForUser(MEMBER_ID);

    const loading = await screen.findByRole("button", {
      name: "Loading follow status…",
    });
    expect(loading).toBeDisabled();
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Loading follow status…", { selector: "p" })).toBeNull();
  });

  it("follows and unfollows another cook while keeping the count current", async () => {
    mocks.setCookFollowing
      .mockResolvedValueOnce({
        cook_id: COOK_ID,
        following: true,
        follower_count: 8,
      })
      .mockResolvedValueOnce({
        cook_id: COOK_ID,
        following: false,
        follower_count: 7,
      });

    renderForUser(MEMBER_ID);

    const follow = await screen.findByRole("button", {
      name: "Follow Alice Cook",
    });
    fireEvent.click(follow);

    const unfollow = await screen.findByRole("button", {
      name: "Unfollow Alice Cook",
    });
    expect(unfollow).toHaveTextContent("Following");
    expect(screen.getByText("8 followers")).toBeVisible();
    expect(setCookFollowing).toHaveBeenNthCalledWith(
      1,
      "alice-cook",
      true,
      expect.any(String),
    );

    fireEvent.click(unfollow);

    expect(
      await screen.findByRole("button", { name: "Follow Alice Cook" }),
    ).toHaveTextContent("Follow");
    expect(screen.getByText("7 followers")).toBeVisible();
    expect(setCookFollowing).toHaveBeenNthCalledWith(
      2,
      "alice-cook",
      false,
      expect.any(String),
    );
  });

  it("keeps the profile metadata count current beside the handle", async () => {
    mocks.setCookFollowing.mockResolvedValue({
      cook_id: COOK_ID,
      following: true,
      follower_count: 8,
    });

    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: MEMBER_ID, display_name: "Bob Cook", handle: "bob-cook" },
        }}
      >
        <CookFollowControl
          cookId={COOK_ID}
          displayName="Alice Cook"
          handle="alice-cook"
          initialFollowerCount={7}
          profileDescription="Seasonal recipes for busy cooks."
          recipeCount={12}
          variant="profile"
        />
      </AuthSessionProvider>,
    );

    expect(document.querySelector(".cook-profile__meta")).toHaveTextContent(
      "@alice-cook•7 followers•12 recipes",
    );
    expect(screen.getByText("Seasonal recipes for busy cooks.")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Follow Alice Cook" }));

    expect(await screen.findByText("8 followers")).toBeVisible();
    expect(document.querySelector(".cook-profile__meta")).toHaveTextContent(
      "@alice-cook•8 followers•12 recipes",
    );
  });

  it("sends anonymous visitors to sign in and preserves the profile return path", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        {control}
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Follow" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Fcooks%2Falice-cook",
    );
    expect(fetchCookFollowState).not.toHaveBeenCalled();
  });

  it("supports a compact recipe byline control without exposing a follower count", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <CookFollowControl
          cookId={COOK_ID}
          displayName="Alice Cook"
          handle="alice-cook"
          initialFollowerCount={7}
          returnTo="/recipes/recipe-one"
          showCount={false}
          variant="inline"
        />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Follow" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Frecipe-one",
    );
    expect(screen.queryByText("7 followers")).toBeNull();
  });

  it("does not offer a member the option to follow their own profile", () => {
    renderForUser(COOK_ID);

    expect(screen.getByText("7 followers")).toBeVisible();
    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
    expect(fetchCookFollowState).not.toHaveBeenCalled();
  });

  it("retries a failed private follow-state request", async () => {
    mocks.fetchCookFollowState
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        cook_id: COOK_ID,
        following: true,
        follower_count: 8,
      });

    renderForUser(MEMBER_ID);

    fireEvent.click(
      await screen.findByRole("button", { name: "Retry follow status" }),
    );

    await waitFor(() => expect(fetchCookFollowState).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: "Unfollow Alice Cook" }),
    ).toBeVisible();
    expect(screen.getByText("8 followers")).toBeVisible();
  });
});
