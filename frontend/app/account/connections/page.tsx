import type { Metadata } from "next";

import {
  parseMemberConnectionsView,
} from "../../../features/community/member-connections-route";
import { parsePositivePageNumber } from "../../../shared/navigation/query-params";
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

export default async function ConnectionsPage({
  searchParams,
}: ConnectionsPageProps) {
  const query = await searchParams;
  return (
    <AccountConnectionsRoute
      pageNumber={parsePositivePageNumber(query.page)}
      view={parseMemberConnectionsView(query.view)}
    />
  );
}
