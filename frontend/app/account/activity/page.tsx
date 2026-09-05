import type { Metadata } from "next";

import { MemberActivityTimeline } from "../../components/member-activity-timeline";

export const metadata: Metadata = {
  title: "Activity",
  description:
    "Review the recipes, saves, and ingredient requests you have worked with recently.",
};

export default function AccountActivityPage() {
  return <MemberActivityTimeline />;
}
