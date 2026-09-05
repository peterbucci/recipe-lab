import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  AuthSessionProvider,
  SessionRecoveryNotice,
} from "../features/auth/auth-session-provider";
import { NavigationBlockerProvider } from "../shared/navigation/navigation-blocker-provider";
import { SiteFooter } from "../shell/site-footer";
import { SiteHeader } from "./_components/site-header";
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
        <NavigationBlockerProvider>
          <AuthSessionProvider>
            <div className="app-shell">
              <SessionRecoveryNotice />
              <SiteHeader />
              {children}
              <SiteFooter />
            </div>
          </AuthSessionProvider>
        </NavigationBlockerProvider>
      </body>
    </html>
  );
}
