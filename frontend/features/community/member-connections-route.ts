import {
  parseAllowedQueryValue,
  type QueryParamValue,
} from "../../shared/navigation/query-params";

export const MEMBER_CONNECTION_VIEWS = ["followers", "following"] as const;

export type MemberConnectionsView = (typeof MEMBER_CONNECTION_VIEWS)[number];

export function parseMemberConnectionsView(
  value: QueryParamValue,
): MemberConnectionsView {
  return parseAllowedQueryValue(value, MEMBER_CONNECTION_VIEWS, "followers");
}

export function connectionsHref(
  view: MemberConnectionsView,
  page = 1,
): string {
  const query = new URLSearchParams({ view });
  if (page > 1) query.set("page", String(page));
  return `/account/connections?${query.toString()}`;
}
