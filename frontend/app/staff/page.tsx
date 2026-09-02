import type { Metadata } from "next";

import { StaffTools } from "../components/staff-tools";

export const metadata: Metadata = {
  title: "Staff Tools",
  description: "Open the staff tools available to your account.",
};

export default function StaffToolsPage() {
  return <StaffTools />;
}
