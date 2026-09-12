import { redirect } from "next/navigation";

export default function AccountFollowersPage() {
  redirect("/account/connections?view=followers");
}
