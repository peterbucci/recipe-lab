interface DemoSandboxInformationProps {
  contactUrl: string;
  expiresAt: string;
  variant: "entry" | "details";
}

const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  weekday: "short",
});

const UTC_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDemoExpiry(expiresAt: string) {
  const expiry = new Date(expiresAt);
  return `${UTC_DATE_FORMATTER.format(expiry)} at ${UTC_TIME_FORMATTER.format(expiry)} GMT`;
}

export function DemoSandboxInformation({
  contactUrl,
  expiresAt,
  variant,
}: DemoSandboxInformationProps) {
  const contactEmail = contactUrl.startsWith("mailto:")
    ? contactUrl.slice(7)
    : null;
  const formattedExpiry = formatDemoExpiry(expiresAt);

  if (variant === "entry") {
    return (
      <div className="demo-sandbox-information">
        <p>
          Start with a temporary demo account—no email or real name required.
          You can publish recipes, make your own versions, save and rate
          recipes, and follow other cooks.
        </p>
        <p>
          Anything you publish is public, so please don’t include personal or
          sensitive information. Demo activity isn’t used for advertising,
          profiling, or ML training.
        </p>
        <p>
          Your demo account and anything you create are temporary and will be
          deleted by <time dateTime={expiresAt}>{formattedExpiry}</time>.
          Signing out ends access to this account.
        </p>
        <p>
          Questions about demo data?{" "}
          <strong>
            <a href={contactUrl} rel="noreferrer">
              Contact {contactEmail ?? "the operator"}
            </a>
          </strong>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="demo-sandbox-information">
      <p>
        You’re using a temporary Recipe Lab account created just for this demo.
        No email or real name is attached to it.
      </p>
      <p>
        Recipes and profiles you publish are visible to anyone using the demo,
        so please don’t include personal or sensitive information. Demo
        activity isn’t used for advertising, profiling, or ML training.
      </p>
      <p>
        Your account and anything you create will be deleted by{" "}
        <time dateTime={expiresAt}>{formattedExpiry}</time>. The demo may reset
        earlier. If you sign out, you won’t be able to return to this account.
      </p>
      <p>
        Questions about your demo data?{" "}
        <strong>
          <a href={contactUrl} rel="noreferrer">
            Contact {contactEmail ?? "the operator"}
          </a>
        </strong>
        .
      </p>
    </div>
  );
}
