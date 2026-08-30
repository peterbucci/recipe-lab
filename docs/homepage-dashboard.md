# Homepage dashboard

Recipe Lab’s homepage combines a public recipe-discovery experience with a small private
summary for signed-in members. The public content remains useful when a visitor is signed out,
still completing onboarding, or unable to load account state.

## Public discovery

- **Featured recipes** are a small, deployment-reviewed global selection. They are not
  personalized, popularity-ranked, or produced by the research recommendation endpoint.
- **Explore by category** uses the curated recipe-category vocabulary. Category links apply an
  exact category filter; they are not keyword searches or inferred dietary claims.
- **From the community** shows a bounded newest-first list of currently readable public
  publications. It never includes drafts, saves, ratings, moderation activity, or hidden and
  withdrawn recipes.
- Every public section has its own empty and unavailable state. A failure in one section does not
  replace the rest of the homepage.

## Member summary

The private summary is mounted only after the existing session provider confirms an authenticated
member. Anonymous and onboarding sessions do not request its APIs.

- **Continue where you left off** links to the member’s most recently updated active draft and
  labels it as an original or version draft. Recipe Lab does not invent a completion percentage.
- **Your stats** uses the existing recipe-library, saved-recipe, and ingredient-request totals.
- **Your activity** combines up to three events from bounded recent results supported by stored
  timestamps: draft updates, recipe publications, saves, and reviewed ingredient requests. It is
  intentionally labeled as recent activity rather than claiming to be a complete account ledger.
- Each private resource loads and retries independently. Changing accounts aborts in-flight work
  and prevents one member’s data from appearing for another.

## Curated recipe categories

The initial vocabulary is Breakfast, Lunch, Dinner, Desserts, Breads, Vegetarian, and Quick &
Easy. Authors select at most three active categories; they cannot create free-text categories.
Selections are stored on drafts, copied when a recipe is forked, and snapshotted onto immutable
publications. Existing demo recipes are categorized explicitly rather than inferred from their
titles or ingredients.

## Footer boundaries

The shared footer links only to routes that exist. Future destinations are visibly marked as
coming soon and are not interactive. Newsletter signup remains absent until Recipe Lab has a real
subscription service and policy.
