import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Recipe Lab",
    template: "%s · Recipe Lab",
  },
  description: "Cook complete recipes, save thoughtful variations, and compare what changed.",
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
              Saves, ratings, views, and new variations use the shared Demo Cook profile and may
              include activity from other visitors.
            </span>
          </div>
        </aside>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <p>Recipe Lab · Cook, adapt, and compare recipes.</p>
        </footer>
      </body>
    </html>
  );
}
