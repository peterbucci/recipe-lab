import type { Metadata } from "next";

import { CommunityActivityTimeline } from "../../components/community-activity-timeline";

export const metadata: Metadata = {
  title: "Community activity",
  description: "See new recipes and versions published by cooks you follow.",
};

export default function CommunityActivityPage() {
  return <CommunityActivityTimeline />;
}
