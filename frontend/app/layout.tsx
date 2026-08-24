import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  AuthSessionProvider,
  SessionRecoveryNotice,
} from "./components/auth-session-provider";
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
        <AuthSessionProvider>
          <SessionRecoveryNotice />
          <SiteHeader />
          {children}
        </AuthSessionProvider>
        <footer className="site-footer">
          <p>Recipe Lab · Explore recipes and compare versions.</p>
        </footer>
      </body>
    </html>
  );
}
