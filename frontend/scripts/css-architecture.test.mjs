import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditCssArchitecture,
  CSS_LAYER_ORDER,
  expectedLayerForPath,
  reservedSelectorOwnershipErrors,
} from "./css-architecture.mjs";

describe("CSS architecture", () => {
  it("keeps every global stylesheet in its declared cascade layer", () => {
    expect(auditCssArchitecture(resolve(import.meta.dirname, ".."))).toEqual([]);
  });

  it("keeps the public layer order stable", () => {
    expect(CSS_LAYER_ORDER).toEqual([
      "tokens",
      "base",
      "shell",
      "primitives",
      "features",
      "patterns",
    ]);
  });

  it("derives ownership from the stylesheet location", () => {
    expect(expectedLayerForPath("app/styles/tokens.css")).toBe("tokens");
    expect(expectedLayerForPath("app/styles/shell/site-shell-auth.css")).toBe("shell");
    expect(expectedLayerForPath("app/styles/features/catalog.css")).toBe("features");
    expect(expectedLayerForPath("app/styles/patterns/workspace-tabs.css")).toBe("patterns");
    expect(expectedLayerForPath("app/styles/unowned.css")).toBeNull();
  });

  it("flags every directly owned reserved selector arm outside its owner", () => {
    const source = `@layer features {
  .feature-card,
  .site-header__inner,
  .state-page--compact,
  .state-panel__actions,
  .workspace-panel-shell,
  .account-menu--compact:hover {
    display: flex;
  }

  @media (max-width: 48rem) {
    .app-shell > main {
      padding: 0;
    }
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([
      'app/styles/features/example.css must not own selector ".site-header__inner"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ".state-page--compact"; .state-page belongs to app/styles/primitives.css.',
      'app/styles/features/example.css must not own selector ".state-panel__actions"; .state-panel belongs to app/styles/primitives.css.',
      'app/styles/features/example.css must not own selector ".workspace-panel-shell"; .workspace-panel-shell belongs to app/styles/primitives.css.',
      'app/styles/features/example.css must not own selector ".account-menu--compact:hover"; .account-menu belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ".app-shell > main"; .app-shell belongs to app/styles/base.css.',
    ]);
  });

  it("flags reserved families anywhere in the first compound selector", () => {
    const source = `@layer features {
  header.site-header,
  .feature.site-header,
  .feature.site-header__inner,
  :where(.site-header),
  .feature:where(.account-menu--compact) {
    display: flex;
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([
      'app/styles/features/example.css must not own selector "header.site-header"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ".feature.site-header"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ".feature.site-header__inner"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ":where(.site-header)"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector ".feature:where(.account-menu--compact)"; .account-menu belongs to app/styles/shell/site-shell-auth.css.',
    ]);
  });

  it("accepts reserved selectors in their owner stylesheets", () => {
    expect(
      reservedSelectorOwnershipErrors(
        "app/styles/shell/site-shell-auth.css",
        ".site-header, .site-footer p, .site-nav__link, .mobile-nav--open, .account-menu__panel {}",
      ),
    ).toEqual([]);
    expect(
      reservedSelectorOwnershipErrors("app/styles/base.css", ".app-shell > main {}"),
    ).toEqual([]);
    expect(
      reservedSelectorOwnershipErrors(
        "app/styles/primitives.css",
        ".state-page, .state-panel[role='alert'], .state-panel__actions, .workspace-empty-state, .workspace-panel-header__actions, :where(.workspace-panel-shell) {}",
      ),
    ).toEqual([]);
  });

  it("accepts context-scoped overrides and non-family prefixes", () => {
    const source = `@layer features {
  .catalog-page .site-header__inner,
  .auth-view > .account-menu,
  .site-header-card,
  .feature.site-header-card,
  .app-shellfish,
  .feature-page .state-panel,
  .workspace-panel-headerish,
  .empty-state:where(:not(.workspace-empty-state)),
  section:has(.site-footer) {
    display: block;
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([]);
  });

  it("rejects unsupported nesting instead of treating it as contextual scope", () => {
    const source = `@layer features {
  .catalog-page {
    & .site-header,
    & > .workspace-panel-header {
      display: block;
    }
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([
      'app/styles/features/example.css must not own selector "& .site-header"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
      'app/styles/features/example.css must not own selector "& > .workspace-panel-header"; .workspace-panel-header belongs to app/styles/primitives.css.',
    ]);
  });

  it("does not treat @scope as a contextual exemption", () => {
    const source = `@layer features {
  @scope (.catalog-page) {
    .site-header {
      display: block;
    }
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([
      'app/styles/features/example.css must not own selector ".site-header"; .site-header belongs to app/styles/shell/site-shell-auth.css.',
    ]);
  });

  it("does not split selector arms at commas inside functions or attributes", () => {
    const source = `@layer features {
  .feature-card:is(.compact, .wide),
  [data-label="header, account"] .account-menu__panel {
    display: block;
  }
}`;

    expect(reservedSelectorOwnershipErrors("app/styles/features/example.css", source)).toEqual([]);
  });
});
