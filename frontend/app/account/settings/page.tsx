import type { Metadata } from "next";

import { AccountSettings } from "../../../features/account/account-settings";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Recipe Lab account.",
};

export default function AccountSettingsPage() {
  return <AccountSettings />;
}
