import { redirect } from "next/navigation";

export default function RecipeDraftsPage() {
  redirect("/account/recipes?view=drafts");
}
