import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { HomeDashboardLayout } from "./components/home-dashboard-layout";
import { HomePublicDiscovery } from "./components/home-public-discovery";
import { SectionLoading } from "./components/loading-ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("recipe_lab_session")) {
    redirect("/recipes");
  }

  return (
    <main id="main-content" className="home-dashboard">
      <HomeDashboardLayout>
        <Suspense
          fallback={
            <div className="home-public-discovery home-public-discovery--loading">
              <SectionLoading
                count={4}
                label="Loading recipe discovery…"
                layout="cards"
              />
            </div>
          }
        >
          <HomePublicDiscovery />
        </Suspense>
      </HomeDashboardLayout>
    </main>
  );
}
