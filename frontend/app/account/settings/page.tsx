import type { Metadata } from "next";

import { AccountSettings } from "../../components/account-settings";

export const metadata: Metadata = {
  title: "Account settings",
  description: "Manage your Recipe Lab account.",
};

export default function AccountSettingsPage() {
  return <AccountSettings />;
}
