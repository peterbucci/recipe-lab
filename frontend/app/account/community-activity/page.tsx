import type { Metadata } from "next";

import { CommunityActivityRoute } from "./_components/community-activity-route";

export const metadata: Metadata = {
  title: "Community activity",
  description: "See new recipes and versions published by cooks you follow.",
};

export default function CommunityActivityPage() {
  return <CommunityActivityRoute />;
}
