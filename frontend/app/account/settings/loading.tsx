import { PageLoadingSkeleton } from "../../components/loading-ui";

export default function AccountSettingsLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell account-settings account-settings-page account-settings-page--loading"
      label="Loading account settings…"
      title="Settings"
      variant="settings"
    />
  );
}
