import type { Metadata } from "next";

import { AccountFollowersRoute } from "./_components/account-followers-route";

export const metadata: Metadata = {
  title: "Followers",
  description: "View the Recipe Lab members who follow your public recipe work.",
};

export default function AccountFollowersPage() {
  return <AccountFollowersRoute />;
}
