import type { Metadata } from "next";

import { MemberFollowersList } from "../../components/member-followers-list";

export const metadata: Metadata = {
  title: "Followers",
  description: "View the Recipe Lab members who follow your public recipe work.",
};

export default function AccountFollowersPage() {
  return <MemberFollowersList />;
}
