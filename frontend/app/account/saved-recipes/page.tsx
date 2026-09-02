import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My recipes",
  description: "Manage recipes you are drafting, sharing, saving, or have withdrawn.",
};

export default function SavedRecipesPage() {
  redirect("/account/recipes?view=saved");
}
