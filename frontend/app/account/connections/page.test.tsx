import { describe, expect, it } from "vitest";

import { AccountConnectionsRoute } from "./_components/account-connections-route";
import ConnectionsPage, { metadata } from "./page";

describe("ConnectionsPage", () => {
  it("passes the URL-addressable Following view and page to the account route", async () => {
    const element = await ConnectionsPage({
      searchParams: Promise.resolve({ view: "following", page: "3" }),
    });

    expect(metadata).toMatchObject({ title: "Connections" });
    expect(element.type).toBe(AccountConnectionsRoute);
    expect(element.props).toMatchObject({ view: "following", pageNumber: 3 });
  });

  it("defaults malformed values to the first Followers page", async () => {
    const malformed = await ConnectionsPage({
      searchParams: Promise.resolve({ view: "blocked", page: "0" }),
    });
    const repeated = await ConnectionsPage({
      searchParams: Promise.resolve({
        view: ["following", "followers"],
        page: ["2", "4"],
      }),
    });

    expect(malformed.props).toMatchObject({
      view: "followers",
      pageNumber: 1,
    });
    expect(repeated.props).toMatchObject({
      view: "following",
      pageNumber: 2,
    });
  });
});
