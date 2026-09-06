import {
  SiteHeaderMemberActions,
  SiteMobileNavigation,
} from "../../features/auth/site-header-member-navigation";
import { SiteHeader as SiteHeaderShell } from "../../shell/site-header";

export function SiteHeader() {
  return (
    <SiteHeaderShell
      memberActions={<SiteHeaderMemberActions />}
      mobileNavigation={<SiteMobileNavigation />}
    />
  );
}
