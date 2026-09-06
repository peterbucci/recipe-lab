import type { Metadata } from "next";

import { AccountActivityRoute } from "./_components/account-activity-route";

export const metadata: Metadata = {
  title: "Activity",
  description:
    "Review the recipes, saves, and ingredient requests you have worked with recently.",
};

export default function AccountActivityPage() {
  return <AccountActivityRoute />;
}
