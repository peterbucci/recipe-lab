import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Recipe Lab",
    template: "%s · Recipe Lab",
  },
  description: "Fork, compare, and learn from structured recipe variants.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <p>Recipe Lab · Structured cooking, version by version.</p>
        </footer>
      </body>
    </html>
  );
}
