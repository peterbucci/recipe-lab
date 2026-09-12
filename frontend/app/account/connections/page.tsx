import type { Metadata } from "next";

import {
  MEMBER_CONNECTION_VIEWS,
  type MemberConnectionsView,
} from "../../../features/community/member-connections-route";
import { AccountConnectionsRoute } from "./_components/account-connections-route";

export const metadata: Metadata = {
  title: "Connections",
  description: "See who follows your recipe work and the cooks you follow.",
};

interface ConnectionsPageProps {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function connectionsView(
  value: string | string[] | undefined,
): MemberConnectionsView {
  const candidate = firstValue(value);
  return (
    MEMBER_CONNECTION_VIEWS.find((view) => view === candidate) ?? "followers"
  );
}

function pageNumber(value: string | string[] | undefined): number {
  const candidate = firstValue(value);
  if (!/^\d+$/.test(candidate)) return 1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000
    ? parsed
    : 1;
}

export default async function ConnectionsPage({
  searchParams,
}: ConnectionsPageProps) {
  const query = await searchParams;
  return (
    <AccountConnectionsRoute
      pageNumber={pageNumber(query.page)}
      view={connectionsView(query.view)}
    />
  );
}
