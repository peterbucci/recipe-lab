import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Recipe Lab",
    template: "%s · Recipe Lab",
  },
  description: "Change a recipe, save your version, and compare it with where you started.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <aside className="public-demo-notice" aria-label="Public demo notice">
          <div className="public-demo-notice__inner">
            <strong>Public demo</strong>
            <span>
              Saves, ratings, views, and versions created here are shared between visitors.
            </span>
          </div>
        </aside>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <p>Recipe Lab · Explore recipes and compare versions.</p>
        </footer>
      </body>
    </html>
  );
}
