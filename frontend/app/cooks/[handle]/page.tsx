import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchPublicCookProfile } from "../../../features/community/public-cook-profile-server-api";
import { parsePositivePageNumber } from "../../../shared/navigation/query-params";
import { CookProfileView } from "./_components/cook-profile-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cook profile",
  description: "Browse the public recipes made by a Recipe Lab cook.",
};

interface CookProfilePageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

export default async function CookProfilePage({ params, searchParams }: CookProfilePageProps) {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{1,28}[A-Za-z0-9])$/.test(handle)) notFound();
  const data = await fetchPublicCookProfile({
    handle,
    page: parsePositivePageNumber(query.page),
    pageSize: 12,
  });
  if (!data) notFound();
  return (
    <main id="main-content" className="page-shell cook-profile public-cook-page">
      <CookProfileView data={data} />
    </main>
  );
}
