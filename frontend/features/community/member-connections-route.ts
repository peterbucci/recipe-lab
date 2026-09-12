export const MEMBER_CONNECTION_VIEWS = ["followers", "following"] as const;

export type MemberConnectionsView = (typeof MEMBER_CONNECTION_VIEWS)[number];

export function connectionsHref(
  view: MemberConnectionsView,
  page = 1,
): string {
  const query = new URLSearchParams({ view });
  if (page > 1) query.set("page", String(page));
  return `/account/connections?${query.toString()}`;
}
