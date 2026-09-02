import { createServer } from "node:http";

const host = process.env.BASELINE_FIXTURE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.BASELINE_FIXTURE_PORT ?? "4318", 10);
if (host !== "127.0.0.1" || port !== 4318) {
  throw new Error("The RCP-34B fixture must use its reviewed loopback origin.");
}

const FIXED_TIME = "2026-08-27T12:00:00.000Z";
const SAFE_CSRF = "rcp34b-public-csrf";
const SAFE_COOKIE = `recipe_lab_csrf=${SAFE_CSRF}`;
const SAFE_ORIGIN = "http://127.0.0.1:4317";
const IDS = Object.freeze({
  user: "10000000-0000-4000-8000-000000000001",
  catalogUser: "10000000-0000-4000-8000-000000000002",
  curatorUser: "10000000-0000-4000-8000-000000000003",
  moderatorUser: "10000000-0000-4000-8000-000000000004",
  onboardingUser: "10000000-0000-4000-8000-000000000005",
  recipeRoot: "20000000-0000-4000-8000-000000000001",
  recipeVariant: "20000000-0000-4000-8000-000000000002",
  recipeChild: "20000000-0000-4000-8000-000000000003",
  lineage: "20000000-0000-4000-8000-000000000010",
  activityPublishedRecipe: "20000000-0000-4000-8000-000000000021",
  activityWithdrawnRecipe: "20000000-0000-4000-8000-000000000022",
  activitySavedShrimp: "20000000-0000-4000-8000-000000000023",
  activitySavedBread: "20000000-0000-4000-8000-000000000024",
  draft: "30000000-0000-4000-8000-000000000001",
  activityDraftCarrot: "30000000-0000-4000-8000-000000000002",
  activityDraftCurry: "30000000-0000-4000-8000-000000000003",
  draftIngredient: "30000000-0000-4000-8000-000000000011",
  draftInstruction: "30000000-0000-4000-8000-000000000021",
  draftAction: "30000000-0000-4000-8000-000000000031",
  tomato: "40000000-0000-4000-8000-000000000001",
  basil: "40000000-0000-4000-8000-000000000002",
  sumac: "40000000-0000-4000-8000-000000000003",
  gram: "50000000-0000-4000-8000-000000000001",
  minute: "50000000-0000-4000-8000-000000000002",
  celsius: "50000000-0000-4000-8000-000000000003",
  simmer: "60000000-0000-4000-8000-000000000001",
  ingredientRequest: "70000000-0000-4000-8000-000000000001",
  approvedRequest: "70000000-0000-4000-8000-000000000002",
  activityApprovedRequest: "70000000-0000-4000-8000-000000000003",
  activityRejectedRequest: "70000000-0000-4000-8000-000000000004",
  report: "80000000-0000-4000-8000-000000000001",
  preflight: "90000000-0000-4000-8000-000000000001",
  breakfastCategory: "a1000000-0000-4000-8000-000000000001",
  lunchCategory: "a1000000-0000-4000-8000-000000000002",
  dinnerCategory: "a1000000-0000-4000-8000-000000000003",
  dessertsCategory: "a1000000-0000-4000-8000-000000000004",
  breadsCategory: "a1000000-0000-4000-8000-000000000005",
  vegetarianCategory: "a1000000-0000-4000-8000-000000000006",
  quickEasyCategory: "a1000000-0000-4000-8000-000000000007",
});

const user = Object.freeze({
  id: IDS.user,
  handle: "baseline-cook",
  display_name: "Baseline Cook",
});
const catalogUser = Object.freeze({
  id: IDS.catalogUser,
  handle: "recipe-lab",
  display_name: "Recipe Lab catalog",
});
const curatorUser = Object.freeze({
  id: IDS.curatorUser,
  handle: "baseline-curator",
  display_name: "Baseline Curator",
});
const moderatorUser = Object.freeze({
  id: IDS.moderatorUser,
  handle: "baseline-moderator",
  display_name: "Baseline Moderator",
});
const onboardingUser = Object.freeze({
  id: IDS.onboardingUser,
  handle: null,
  display_name: "Baseline New Cook",
});
const session = Object.freeze({
  status: "authenticated",
  user,
  capabilities: {
    moderate_recipe_reports: true,
    review_ingredient_requests: true,
  },
});
const curatorSession = Object.freeze({
  status: "authenticated",
  user: curatorUser,
  capabilities: {
    moderate_recipe_reports: false,
    review_ingredient_requests: true,
  },
});
const moderatorSession = Object.freeze({
  status: "authenticated",
  user: moderatorUser,
  capabilities: {
    moderate_recipe_reports: true,
    review_ingredient_requests: false,
  },
});
const onboardingSession = Object.freeze({
  status: "onboarding_required",
  user: onboardingUser,
  capabilities: {
    moderate_recipe_reports: false,
    review_ingredient_requests: false,
  },
});

const gramSummary = Object.freeze({
  id: IDS.gram,
  key: "gram",
  dimension: "mass",
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol",
  active: true,
});
const minuteSummary = Object.freeze({
  id: IDS.minute,
  key: "minute",
  dimension: "time",
  canonical_label: "minute",
  plural_label: "minutes",
  symbol: "min",
  display_style: "symbol",
  active: true,
});
const celsiusSummary = Object.freeze({
  id: IDS.celsius,
  key: "degree-celsius",
  dimension: "temperature",
  canonical_label: "degree Celsius",
  plural_label: "degrees Celsius",
  symbol: "°C",
  display_style: "symbol",
  active: true,
});
const units = Object.freeze([
  {
    ...gramSummary,
    aliases: ["grams"],
    provenance: "Synthetic baseline catalog.",
  },
  {
    ...minuteSummary,
    aliases: ["minutes"],
    provenance: "Synthetic baseline catalog.",
  },
  {
    ...celsiusSummary,
    aliases: ["Celsius"],
    provenance: "Synthetic baseline catalog.",
  },
]);
const simmerAction = Object.freeze({
  id: IDS.simmer,
  key: "simmer",
  canonical_verb: "simmer",
  active: true,
  provenance: "Synthetic baseline catalog.",
});
const tomato = Object.freeze({
  id: IDS.tomato,
  canonical_name: "Plum tomato",
  aliases: ["Roma tomato"],
});
const basil = Object.freeze({
  id: IDS.basil,
  canonical_name: "Sweet basil",
  aliases: ["Basil"],
});
const sumac = Object.freeze({
  id: IDS.sumac,
  canonical_name: "Sumac",
  aliases: ["Ground sumac"],
});

const recipeCategories = Object.freeze([
  { id: IDS.breakfastCategory, name: "Breakfast", slug: "breakfast" },
  { id: IDS.lunchCategory, name: "Lunch", slug: "lunch" },
  { id: IDS.dinnerCategory, name: "Dinner", slug: "dinner" },
  { id: IDS.dessertsCategory, name: "Desserts", slug: "desserts" },
  { id: IDS.breadsCategory, name: "Breads", slug: "breads" },
  { id: IDS.vegetarianCategory, name: "Vegetarian", slug: "vegetarian" },
  { id: IDS.quickEasyCategory, name: "Quick & Easy", slug: "quick-easy" },
]);

function recipeSummary({
  id,
  parentVersionId,
  versionNumber,
  title,
  description,
  author = user,
  parent = null,
  categories = [recipeCategories[1], recipeCategories[5]],
  publishedAt = FIXED_TIME,
}) {
  return {
    id,
    lineage_id: IDS.lineage,
    parent_version_id: parentVersionId,
    version_number: versionNumber,
    title,
    description,
    servings: "4.00",
    created_at: FIXED_TIME,
    published_at: publishedAt,
    author,
    parent,
    categories,
  };
}

const rootSummary = Object.freeze(
  recipeSummary({
    id: IDS.recipeRoot,
    parentVersionId: null,
    versionNumber: 1,
    title: "Sunlit Tomato Soup",
    description: "A bright tomato soup made for a quiet lunch.",
    author: catalogUser,
    publishedAt: "2026-08-25T12:00:00.000Z",
  }),
);
const rootReference = Object.freeze({
  id: IDS.recipeRoot,
  version_number: 1,
  title: rootSummary.title,
  author: catalogUser,
});
const variantSummary = Object.freeze(
  recipeSummary({
    id: IDS.recipeVariant,
    parentVersionId: IDS.recipeRoot,
    versionNumber: 2,
    title: "Garden Cream Tomato Soup",
    description: "The original soup with basil and a gentle creamy finish.",
    parent: rootReference,
    categories: [recipeCategories[2], recipeCategories[5]],
    publishedAt: "2026-08-26T12:00:00.000Z",
  }),
);
const childSummary = Object.freeze(
  recipeSummary({
    id: IDS.recipeChild,
    parentVersionId: IDS.recipeVariant,
    versionNumber: 3,
    title: "Roasted Garden Tomato Soup",
    description: "A roasted variation with a deeper tomato flavor.",
    categories: [recipeCategories[2], recipeCategories[6]],
    parent: {
      id: IDS.recipeVariant,
      version_number: 2,
      title: variantSummary.title,
      author: user,
    },
  }),
);

const featuredSummaries = Object.freeze([
  Object.freeze({
    ...variantSummary,
    average_rating: 4.5,
    rating_count: 8,
    save_count: 14,
  }),
  Object.freeze({
    ...rootSummary,
    average_rating: 4.8,
    rating_count: 12,
    save_count: 21,
  }),
  Object.freeze({
    ...childSummary,
    average_rating: null,
    rating_count: 0,
    save_count: 3,
  }),
]);
const catalogSummaries = Object.freeze([
  featuredSummaries[1],
  featuredSummaries[0],
  featuredSummaries[2],
]);
const profileSummaries = Object.freeze([
  featuredSummaries[0],
  featuredSummaries[2],
]);
const communitySummaries = Object.freeze([
  Object.freeze({ ...childSummary, author: catalogUser }),
  Object.freeze({ ...variantSummary, author: catalogUser }),
  rootSummary,
]);

function detailFor(summary) {
  const isRoot = summary.id === IDS.recipeRoot;
  return {
    ...summary,
    total_time_minutes: 45,
    active_time_minutes: 20,
    difficulty: "easy",
    notes: "Taste before serving and adjust the seasoning if needed.",
    average_rating: isRoot ? 4.8 : 4.5,
    rating_count: isRoot ? 12 : 8,
    save_count: isRoot ? 21 : 14,
    viewer_state: {
      recipe_version_id: summary.id,
      saved: summary.id === IDS.recipeVariant,
      rating: summary.id === IDS.recipeVariant ? 4 : null,
    },
    children:
      summary.id === IDS.recipeVariant
        ? [
            {
              id: IDS.recipeChild,
              version_number: 3,
              title: childSummary.title,
              author: user,
            },
          ]
        : [
            {
              id: IDS.recipeVariant,
              version_number: 2,
              title: variantSummary.title,
              author: user,
            },
          ],
    ingredients: [
      {
        id: "41000000-0000-4000-8000-000000000001",
        ingredient_id: IDS.tomato,
        canonical_name: tomato.canonical_name,
        display_name: "ripe plum tomatoes",
        measure: {
          kind: "exact",
          value: "800.0000",
          unit: gramSummary,
          display_unit: "g",
          display: "800 g",
        },
        preparation_notes: "roughly chopped",
        display_order: 0,
      },
      {
        id: "41000000-0000-4000-8000-000000000002",
        ingredient_id: IDS.basil,
        canonical_name: basil.canonical_name,
        display_name: "fresh basil",
        measure: {
          kind: "qualitative",
          value: "as_needed",
          unit: null,
          display_unit: null,
          display: "As needed",
        },
        preparation_notes: "torn",
        display_order: 1,
      },
    ],
    instructions: [
      {
        id: "42000000-0000-4000-8000-000000000001",
        title: "Simmer the tomatoes",
        text: "Simmer the tomatoes until soft and fragrant.",
        display_order: 0,
        actions: [
          {
            id: "43000000-0000-4000-8000-000000000001",
            action_type: {
              id: simmerAction.id,
              key: simmerAction.key,
              canonical_verb: simmerAction.canonical_verb,
              active: true,
            },
            display_order: 0,
            ingredient_occurrence_ids: ["41000000-0000-4000-8000-000000000001"],
            duration: {
              kind: "exact",
              value: "20.0000",
              unit: minuteSummary,
              display_unit: "min",
              display: "20 min",
            },
            temperature: null,
          },
        ],
      },
      {
        id: "42000000-0000-4000-8000-000000000002",
        title: "Blend and finish",
        text: "Blend until smooth, then fold in the basil.",
        display_order: 1,
        actions: [],
      },
    ],
  };
}

const diff = Object.freeze({
  lineage_id: IDS.lineage,
  base_version: rootReference,
  target_version: {
    id: IDS.recipeVariant,
    version_number: 2,
    title: variantSummary.title,
    author: user,
  },
  metadata_changes: [
    { field: "title", before: rootSummary.title, after: variantSummary.title },
    {
      field: "description",
      before: rootSummary.description,
      after: variantSummary.description,
    },
  ],
  ingredients: {
    added: [detailFor(variantSummary).ingredients[1]],
    removed: [],
    replaced: [],
    modified: [
      {
        before: {
          ...detailFor(rootSummary).ingredients[0],
          measure: {
            ...detailFor(rootSummary).ingredients[0].measure,
            value: "900.0000",
            display: "900 g",
          },
        },
        after: detailFor(variantSummary).ingredients[0],
        changed_fields: ["measure", "preparation_notes"],
      },
    ],
  },
  ingredient_context: {
    base: detailFor(rootSummary).ingredients,
    target: detailFor(variantSummary).ingredients,
  },
  instructions: {
    added: [],
    removed: [],
    modified: [
      {
        before: {
          id: "42000000-0000-4000-8000-000000000010",
          title: "Soften the tomatoes",
          text: "Simmer the tomatoes until soft.",
          display_order: 0,
          actions: [],
        },
        after: detailFor(variantSummary).instructions[0],
        changed_fields: ["title", "text", "actions"],
      },
    ],
  },
  has_changes: true,
});

function draftDetail(complete, unresolvedIngredient = false) {
  return {
    id: IDS.draft,
    source_version_id: scenario === "fork-draft" ? IDS.recipeRoot : null,
    status: "active",
    revision: 4,
    title: complete ? "Late-Summer Tomato Pot" : "",
    description: complete ? "A small-batch soup for a shared table." : null,
    servings: complete ? "4" : null,
    total_time_minutes: complete ? 35 : null,
    active_time_minutes: complete ? 15 : null,
    difficulty: complete ? "easy" : null,
    notes: null,
    ingredients: complete
      ? [
          {
            id: IDS.draftIngredient,
            display_order: 0,
            selection: unresolvedIngredient
              ? {
                  kind: "request",
                  request: {
                    id: IDS.ingredientRequest,
                    proposed_name: "Sunberry tomato",
                    status: "pending",
                    resolved_ingredient: null,
                  },
                }
              : {
                  kind: "catalog",
                  ingredient: tomato,
                  display_name: "plum tomatoes",
                },
            measure: {
              kind: "exact",
              value: "800",
              unit: gramSummary,
              display_unit: "g",
              display: "800 g",
            },
            preparation_notes: "roughly chopped",
          },
        ]
      : [],
    instructions: complete
      ? [
          {
            id: IDS.draftInstruction,
            display_order: 0,
            title: "Simmer the soup",
            text: "Simmer until the tomatoes collapse into a glossy soup.",
            actions: [
              {
                id: IDS.draftAction,
                display_order: 0,
                action_type: {
                  id: simmerAction.id,
                  key: simmerAction.key,
                  canonical_verb: simmerAction.canonical_verb,
                  active: true,
                },
                ingredient_occurrence_ids: [IDS.draftIngredient],
                duration: {
                  kind: "exact",
                  value: "20",
                  unit: minuteSummary,
                  display_unit: "min",
                  display: "20 min",
                },
                temperature: null,
              },
            ],
          },
        ]
      : [],
    categories: complete ? [recipeCategories[1], recipeCategories[5]] : [],
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
  };
}

const draftListItem = Object.freeze({
  id: IDS.draft,
  source_version_id: null,
  status: "active",
  revision: 4,
  title: "Late-Summer Tomato Pot",
  ingredient_count: 1,
  instruction_count: 1,
  created_at: FIXED_TIME,
  updated_at: FIXED_TIME,
});

const activityDraftItems = Object.freeze([
  Object.freeze({
    kind: "draft",
    draft: Object.freeze({
      ...draftListItem,
      title: "Banana Oat Pancakes",
      updated_at: "2026-08-27T11:00:00.000Z",
    }),
    source_recipe_title: null,
    description: "A cozy breakfast draft with oats and ripe banana.",
  }),
  Object.freeze({
    kind: "draft",
    draft: Object.freeze({
      ...draftListItem,
      id: IDS.activityDraftCarrot,
      title: "Orange Raisin Carrot Cake",
      updated_at: "2026-08-27T09:00:00.000Z",
    }),
    source_recipe_title: null,
    description: "A bright carrot cake draft with citrus and raisins.",
  }),
  Object.freeze({
    kind: "draft",
    draft: Object.freeze({
      ...draftListItem,
      id: IDS.activityDraftCurry,
      title: "Weeknight Green Curry",
      updated_at: "2026-08-26T09:02:00.000Z",
    }),
    source_recipe_title: null,
    description: "A quick green curry for busy evenings.",
  }),
]);

const activityPublishedRecipe = Object.freeze(
  recipeSummary({
    id: IDS.activityPublishedRecipe,
    parentVersionId: null,
    versionNumber: 1,
    title: "Red Lentil Coconut Stew",
    description: "A warm lentil stew with coconut milk and gentle spices.",
    publishedAt: "2026-08-26T16:42:00.000Z",
  }),
);
const activityWithdrawnRecipe = Object.freeze(
  recipeSummary({
    id: IDS.activityWithdrawnRecipe,
    parentVersionId: null,
    versionNumber: 1,
    title: "Pecan Banana Oat Pancakes",
    description: "A nutty pancake variation saved for another day.",
    publishedAt: "2026-08-24T15:30:00.000Z",
  }),
);
const activitySavedShrimp = Object.freeze(
  recipeSummary({
    id: IDS.activitySavedShrimp,
    parentVersionId: null,
    versionNumber: 1,
    title: "Garlic Butter Shrimp Pasta",
    description: "A quick pasta with garlic, shrimp, and lemon.",
    publishedAt: "2026-08-20T12:00:00.000Z",
  }),
);
const activitySavedBread = Object.freeze(
  recipeSummary({
    id: IDS.activitySavedBread,
    parentVersionId: null,
    versionNumber: 1,
    title: "Sourdough Bread",
    description: "A patient loaf with a crisp crust and open crumb.",
    publishedAt: "2026-08-18T12:00:00.000Z",
  }),
);

const activityRecipeItems = Object.freeze({
  drafts: activityDraftItems,
  published: Object.freeze([
    Object.freeze({
      kind: "published",
      recipe: activityPublishedRecipe,
      visibility_state: "published",
    }),
  ]),
  withdrawn: Object.freeze([
    Object.freeze({
      kind: "published",
      recipe: activityWithdrawnRecipe,
      visibility_state: "author_withdrawn",
    }),
  ]),
});

const activitySavedItems = Object.freeze([
  Object.freeze({
    recipe: activitySavedShrimp,
    saved_at: "2026-08-26T11:18:00.000Z",
  }),
  Object.freeze({
    recipe: activitySavedBread,
    saved_at: "2026-08-25T14:00:00.000Z",
  }),
]);

const ingredientReviewItem = Object.freeze({
  id: IDS.ingredientRequest,
  proposed_name: "Sunberry tomato",
  context: "A small golden tomato found at a public farmers market.",
  status: "pending",
  created_at: FIXED_TIME,
  updated_at: FIXED_TIME,
  reviewed_at: null,
  decision_reason: null,
  resolved_ingredient_id: null,
  requester_user_id: IDS.user,
  reviewer_user_id: null,
  duplicate_of_request_id: null,
  approved_canonical_name: null,
  approved_aliases: null,
  approval_provenance: null,
});
const ingredientReviewDetail = Object.freeze({
  ...ingredientReviewItem,
  requester: user,
  catalog_candidates: [tomato],
  request_candidates: [
    {
      id: IDS.approvedRequest,
      proposed_name: "Golden plum tomato",
      status: "approved",
      created_at: FIXED_TIME,
      resolved_ingredient_id: IDS.tomato,
      approved_canonical_name: tomato.canonical_name,
    },
  ],
});
const reviewedIngredientReviewItem = Object.freeze({
  ...ingredientReviewItem,
  status: "approved",
  updated_at: FIXED_TIME,
  reviewed_at: FIXED_TIME,
  decision_reason:
    "The current catalog review confirms this synthetic ingredient.",
  resolved_ingredient_id: IDS.tomato,
  reviewer_user_id: IDS.curatorUser,
  approved_canonical_name: "Sunberry tomato",
  approved_aliases: [],
  approval_provenance: "Synthetic curator retry evidence.",
});
const reviewedIngredientReviewDetail = Object.freeze({
  ...ingredientReviewDetail,
  ...reviewedIngredientReviewItem,
});

const memberIngredientRequest = Object.freeze({
  id: IDS.ingredientRequest,
  proposed_name: "Sunberry tomato",
  context: "A small golden tomato found at a public farmers market.",
  status: "pending",
  created_at: FIXED_TIME,
  reviewed_at: null,
  decision_reason: null,
  resolved_ingredient_id: null,
  resolved_ingredient: null,
});

const activityIngredientRequests = Object.freeze([
  Object.freeze({
    id: IDS.activityApprovedRequest,
    proposed_name: "Sumac",
    context: "A tart red spice used to finish salads and flatbreads.",
    status: "approved",
    created_at: "2026-08-22T10:00:00.000Z",
    reviewed_at: "2026-08-27T06:00:00.000Z",
    decision_reason: "Approved for the shared ingredient catalog.",
    resolved_ingredient_id: IDS.sumac,
    resolved_ingredient: sumac,
  }),
  Object.freeze({
    id: IDS.activityRejectedRequest,
    proposed_name: "Test Ingredient",
    context: "A deterministic request used by the activity baseline.",
    status: "rejected",
    created_at: "2026-08-21T10:00:00.000Z",
    reviewed_at: "2026-08-25T08:30:00.000Z",
    decision_reason: "The request needs a clearer common ingredient name.",
    resolved_ingredient_id: null,
    resolved_ingredient: null,
  }),
]);

const moderationSummary = Object.freeze({
  recipe_version_id: IDS.recipeRoot,
  title: "Sunlit Tomato Soup",
  author: catalogUser,
  status: "open",
  visibility_state: "published",
  reporter_count: 2,
  opened_at: FIXED_TIME,
  last_reported_at: FIXED_TIME,
  resolved_at: null,
});
const moderationDetail = Object.freeze({
  ...moderationSummary,
  reason_counts: [
    { reason: "spam", count: 1 },
    { reason: "dangerous_content", count: 1 },
  ],
  reports: [
    {
      id: IDS.report,
      reason: "spam",
      details: "Repeated promotional links in the public description.",
      submitted_at: FIXED_TIME,
    },
  ],
  reports_total: 1,
  reports_truncated: false,
  history: [
    {
      id: 1,
      action: "restore",
      previous_status: "open",
      status: "open",
      visibility_state: "published",
      private_note: "Synthetic prior review note.",
      occurred_at: FIXED_TIME,
      actor: user,
    },
  ],
  history_total: 1,
  history_truncated: false,
});

const probablePreflight = Object.freeze({
  classification: "probable_duplicate",
  same_lineage_no_change: false,
  candidates: [
    {
      public_recipe_version_id: IDS.recipeRoot,
      title: rootSummary.title,
      classification: "probable_duplicate",
      score: "0.870000",
      reasons: [
        {
          code: "matching_structure",
          message: "The ingredient and instruction structure is similar.",
        },
      ],
    },
  ],
  warnings: [],
  acknowledgement: {
    preflight_id: IDS.preflight,
    policy_version: "recipe-duplicate-preflight-policy-v1",
    result_digest: "a".repeat(64),
    required: true,
    allowed_decisions: ["continue", "revise"],
  },
});

const allowedScenarios = new Set([
  "activity-normal",
  "anonymous-session",
  "auth-error",
  "curation-empty",
  "curation-stale-once",
  "curator-session",
  "fork-draft",
  "normal",
  "homepage-empty",
  "homepage-partial-error",
  "moderation-detail-not-found",
  "moderation-queue-failure-once",
  "moderator-session",
  "onboarding-session",
  "slow-draft-creation",
  "slow-curator-session",
  "incomplete-draft",
  "unresolved-draft",
  "library-failure",
  "expired-library",
  "public-context-failure",
  "sparse-own-profile",
  "slow-session",
]);
const curatorScenarios = new Set([
  "curation-empty",
  "curation-stale-once",
  "curator-session",
  "slow-curator-session",
]);
const moderatorScenarios = new Set([
  "moderation-detail-not-found",
  "moderation-queue-failure-once",
  "moderator-session",
]);
let scenario = "normal";
let audit = freshAudit();
let scenarioState = freshScenarioState();

function freshScenarioState() {
  const homepageIsEmpty = scenario === "homepage-empty";
  return {
    baselineCookFollowerCount: homepageIsEmpty ? 0 : 9,
    curationDecisionApplied: false,
    curationReviewAttempts: 0,
    followingBaselineCook: false,
    memberFollowingCount: homepageIsEmpty ? 0 : 3,
    moderationQueueAttempts: 0,
  };
}

function currentSession() {
  if (scenario === "anonymous-session") return { status: "anonymous" };
  if (scenario === "onboarding-session") return onboardingSession;
  if (curatorScenarios.has(scenario)) return curatorSession;
  if (moderatorScenarios.has(scenario)) return moderatorSession;
  return session;
}

function requireActiveMember(response) {
  const activeSession = currentSession();
  if (
    activeSession.status === "authenticated" &&
    activeSession.user.handle !== null
  ) {
    return activeSession;
  }
  if (activeSession.status === "onboarding_required") {
    sendError(
      response,
      403,
      "account_setup_required",
      "Finish account setup to continue.",
    );
  } else {
    sendError(response, 401, "authentication_required", "Sign in to continue.");
  }
  return null;
}

function hasValidMemberCsrf(request) {
  const fetchSite = request.headers["sec-fetch-site"];
  return (
    request.headers.cookie === SAFE_COOKIE &&
    request.headers.origin === SAFE_ORIGIN &&
    request.headers["x-csrf-token"] === SAFE_CSRF &&
    (fetchSite === undefined || fetchSite.toLowerCase() !== "cross-site")
  );
}

function hasStaffCapability(capability) {
  const activeSession = currentSession();
  return (
    activeSession.status === "authenticated" &&
    activeSession.capabilities?.[capability] === true
  );
}

function rejectStaffAuthorization(response, label) {
  countRoute(label);
  sendError(
    response,
    403,
    "baseline_staff_authorization_required",
    "The synthetic staff route is not available to this account.",
  );
}

function freshAudit() {
  return {
    accepted_api_requests: 0,
    unknown_api_requests: 0,
    privacy_rejections: 0,
    route_counts: Object.create(null),
  };
}

function countRoute(label) {
  audit.accepted_api_requests += 1;
  audit.route_counts[label] = (audit.route_counts[label] ?? 0) + 1;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendError(response, status, code, message) {
  sendJson(response, status, {
    error: {
      code,
      message,
      issues: [],
      correlation_id: "a0000000-0000-4000-8000-000000000001",
    },
  });
}

function requestHasPrivateMaterial(request) {
  const authorization = request.headers.authorization;
  const proxyAuthorization = request.headers["proxy-authorization"];
  const apiKey = request.headers["x-api-key"];
  const cookie = request.headers.cookie;
  const csrf = request.headers["x-csrf-token"];
  return Boolean(
    authorization ||
    proxyAuthorization ||
    apiKey ||
    (cookie && cookie !== SAFE_COOKIE) ||
    (csrf && csrf !== SAFE_CSRF),
  );
}

function apiPage(items, pageSize = 12) {
  return {
    items,
    page: 1,
    page_size: pageSize,
    total: items.length,
    total_pages: items.length ? 1 : 0,
  };
}

async function handleApi(request, response, url) {
  if (requestHasPrivateMaterial(request)) {
    audit.privacy_rejections += 1;
    sendError(
      response,
      400,
      "baseline_private_material_rejected",
      "The fixture rejected this request.",
    );
    return;
  }

  const method = request.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/auth/session") {
    countRoute("auth-session");
    if (scenario === "auth-error") {
      sendError(
        response,
        503,
        "authentication_unavailable",
        "The synthetic account service is temporarily unavailable.",
      );
      return;
    }
    const responseSession = currentSession();
    if (scenario === "slow-session" || scenario === "slow-curator-session") {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    sendJson(response, 200, responseSession);
    return;
  }

  if (method === "GET" && path === "/api/recipes") {
    countRoute("recipe-catalog");
    const query = url.searchParams.get("q")?.trim() ?? "";
    const variant = url.searchParams.get("is_variant");
    let items = query === "No baseline matches" ? [] : catalogSummaries;
    if (variant === "true")
      items = items.filter((item) => item.parent_version_id !== null);
    if (variant === "false")
      items = items.filter((item) => item.parent_version_id === null);
    const category = url.searchParams.get("category");
    if (category) {
      items = items.filter((item) =>
        item.categories.some((itemCategory) => itemCategory.slug === category),
      );
    }
    if (url.searchParams.get("sort") === "newest") {
      items = [...items].sort(
        (left, right) =>
          right.published_at.localeCompare(left.published_at) ||
          left.id.localeCompare(right.id),
      );
    }
    if (
      scenario === "homepage-empty" &&
      url.searchParams.get("sort") === "newest"
    ) {
      items = [];
    }
    const requestedPageSize = Number.parseInt(
      url.searchParams.get("page_size") ?? "12",
      10,
    );
    sendJson(response, 200, apiPage(items, requestedPageSize));
    return;
  }

  if (method === "GET" && path === "/api/recipes/featured") {
    countRoute("featured-recipes");
    if (scenario === "homepage-partial-error") {
      sendError(
        response,
        503,
        "featured_recipes_unavailable",
        "The synthetic featured shelf is temporarily unavailable.",
      );
      return;
    }
    sendJson(response, 200, {
      items: scenario === "homepage-empty" ? [] : featuredSummaries,
    });
    return;
  }

  if (method === "GET" && path === "/api/recipes/viewer-states") {
    countRoute("recipe-viewer-states");
    if (requireActiveMember(response) === null) return;
    const recipeVersionIds = [
      ...new Set(url.searchParams.getAll("recipe_version_id")),
    ];
    sendJson(response, 200, {
      items: recipeVersionIds.map((recipeVersionId) => ({
        recipe_version_id: recipeVersionId,
        saved: recipeVersionId === IDS.recipeVariant,
        rating: recipeVersionId === IDS.recipeVariant ? 4 : null,
      })),
    });
    return;
  }

  if (method === "GET" && path === "/api/recipe-categories") {
    countRoute("recipe-categories");
    sendJson(response, 200, {
      items: scenario === "homepage-empty" ? [] : recipeCategories,
    });
    return;
  }

  if (method === "GET" && path === `/api/cooks/${user.handle}`) {
    countRoute("cook-profile");
    if (scenario === "public-context-failure") {
      sendError(
        response,
        503,
        "recipe_library_unavailable",
        "The synthetic public profile is temporarily unavailable.",
      );
      return;
    }
    const sparseOwnProfile = scenario === "sparse-own-profile";
    sendJson(response, 200, {
      ...apiPage(
        sparseOwnProfile ? profileSummaries.slice(0, 1) : profileSummaries,
      ),
      cook: user,
      description: sparseOwnProfile
        ? null
        : "Weeknight recipes shaped by small experiments and shared tables.",
      follower_count: scenarioState.baselineCookFollowerCount,
    });
    return;
  }

  const cookFollowMatch = path.match(/^\/api\/cooks\/([^/]+)\/follow$/i);
  if (
    cookFollowMatch &&
    (method === "GET" || method === "PUT" || method === "DELETE")
  ) {
    countRoute(
      method === "GET"
        ? "cook-follow-state"
        : method === "PUT"
          ? "cook-follow"
          : "cook-unfollow",
    );
    const activeSession = requireActiveMember(response);
    if (activeSession === null) return;

    const targetHandle = decodeURIComponent(cookFollowMatch[1]).toLowerCase();
    if (targetHandle !== user.handle) {
      sendError(response, 404, "cook_not_found", "The cook was not found.");
      return;
    }

    if (method !== "GET") {
      if (!hasValidMemberCsrf(request)) {
        sendError(
          response,
          403,
          "invalid_csrf",
          "The request could not be verified.",
        );
        return;
      }
      if (activeSession.user.id === user.id) {
        sendError(
          response,
          409,
          "cannot_follow_self",
          "You cannot follow your own account.",
        );
        return;
      }

      const shouldFollow = method === "PUT";
      if (shouldFollow !== scenarioState.followingBaselineCook) {
        scenarioState.followingBaselineCook = shouldFollow;
        scenarioState.baselineCookFollowerCount += shouldFollow ? 1 : -1;
        scenarioState.memberFollowingCount += shouldFollow ? 1 : -1;
      }
    }

    sendJson(response, 200, {
      cook_id: user.id,
      following:
        activeSession.user.id === user.id
          ? false
          : scenarioState.followingBaselineCook,
      follower_count: scenarioState.baselineCookFollowerCount,
    });
    return;
  }

  const diffMatch = path.match(/^\/api\/recipes\/([0-9a-f-]+)\/diff$/i);
  if (method === "GET" && diffMatch?.[1] === IDS.recipeVariant) {
    countRoute("recipe-diff");
    sendJson(response, 200, diff);
    return;
  }

  const viewMatch = path.match(/^\/api\/recipes\/([0-9a-f-]+)\/view$/i);
  if (
    method === "POST" &&
    viewMatch &&
    [IDS.recipeRoot, IDS.recipeVariant, IDS.recipeChild].includes(viewMatch[1])
  ) {
    countRoute("recipe-view");
    sendJson(response, 200, { recorded: true });
    return;
  }

  const recipeMatch = path.match(/^\/api\/recipes\/([0-9a-f-]+)$/i);
  if (method === "GET" && recipeMatch) {
    const summaries = new Map([
      [IDS.recipeRoot, rootSummary],
      [IDS.recipeVariant, variantSummary],
      [IDS.recipeChild, childSummary],
    ]);
    const summary = summaries.get(recipeMatch[1]);
    if (summary) {
      countRoute("recipe-detail");
      if (scenario === "public-context-failure") {
        sendError(
          response,
          503,
          "recipe_service_unavailable",
          "The synthetic public recipe is temporarily unavailable.",
        );
        return;
      }
      sendJson(response, 200, detailFor(summary));
    } else {
      countRoute("recipe-missing");
      sendError(response, 404, "recipe_not_found", "The recipe was not found.");
    }
    return;
  }

  if (method === "GET" && path === "/api/my/follow-stats") {
    countRoute("follow-stats");
    const activeSession = requireActiveMember(response);
    if (activeSession === null) return;
    sendJson(response, 200, {
      follower_count:
        activeSession.user.id === user.id
          ? scenarioState.baselineCookFollowerCount
          : 0,
      following_count: scenarioState.memberFollowingCount,
    });
    return;
  }

  if (method === "GET" && path === "/api/my/community-activity") {
    countRoute("community-activity");
    if (requireActiveMember(response) === null) return;
    const requestedPage = Number.parseInt(
      url.searchParams.get("page") ?? "1",
      10,
    );
    const requestedPageSize = Number.parseInt(
      url.searchParams.get("page_size") ?? "20",
      10,
    );
    const allItems = scenario === "homepage-empty" ? [] : communitySummaries;
    const start = (requestedPage - 1) * requestedPageSize;
    sendJson(response, 200, {
      items: allItems.slice(start, start + requestedPageSize),
      page: requestedPage,
      page_size: requestedPageSize,
      total: allItems.length,
      total_pages: allItems.length
        ? Math.ceil(allItems.length / requestedPageSize)
        : 0,
    });
    return;
  }

  if (method === "GET" && path === "/api/my/recipes") {
    countRoute("my-recipes");
    if (scenario === "library-failure") {
      sendError(
        response,
        503,
        "baseline_service_unavailable",
        "The synthetic recipe library is temporarily unavailable.",
      );
      return;
    }
    if (scenario === "expired-library") {
      sendError(
        response,
        401,
        "session_expired",
        "Your session expired. Sign in again to continue.",
      );
      return;
    }
    const view = url.searchParams.get("view");
    const itemsByView = {
      drafts: [
        {
          kind: "draft",
          draft: draftListItem,
          source_recipe_title: null,
          description: "A small-batch soup for a shared table.",
        },
      ],
      published: [
        {
          kind: "published",
          recipe: rootSummary,
          visibility_state: "published",
        },
        {
          kind: "published",
          recipe: variantSummary,
          visibility_state: "moderation_hidden",
        },
      ],
      withdrawn: [
        {
          kind: "published",
          recipe: childSummary,
          visibility_state: "author_withdrawn",
        },
      ],
    };
    const items =
      scenario === "activity-normal"
        ? activityRecipeItems[view]
        : itemsByView[view];
    if (!items) {
      sendError(
        response,
        422,
        "validation_error",
        "Choose drafts, published, or withdrawn.",
      );
      return;
    }
    const responseItems = scenario === "homepage-empty" ? [] : items;
    const requestedPageSize = Number.parseInt(
      url.searchParams.get("page_size") ?? "12",
      10,
    );
    sendJson(response, 200, {
      items: responseItems,
      page: 1,
      page_size: requestedPageSize,
      total: responseItems.length,
      total_pages: responseItems.length ? 1 : 0,
    });
    return;
  }

  if (method === "GET" && path === "/api/my/saved-recipes") {
    countRoute("saved-recipes");
    if (scenario === "homepage-partial-error") {
      sendError(
        response,
        503,
        "saved_recipes_unavailable",
        "The synthetic saved recipe library is temporarily unavailable.",
      );
      return;
    }
    const savedItems =
      scenario === "homepage-empty"
        ? []
        : scenario === "activity-normal"
          ? activitySavedItems
          : [{ recipe: variantSummary, saved_at: FIXED_TIME }];
    const requestedPageSize = Number.parseInt(
      url.searchParams.get("page_size") ?? "12",
      10,
    );
    sendJson(response, 200, {
      items: savedItems,
      page: 1,
      page_size: requestedPageSize,
      total: savedItems.length,
      total_pages: savedItems.length ? 1 : 0,
    });
    return;
  }

  if (method === "GET" && path === "/api/measurement-units") {
    countRoute("measurement-units");
    const semantic = url.searchParams.get("semantic");
    const dimensions = {
      ingredient_amount: new Set(["mass", "volume", "count", "package"]),
      action_duration: new Set(["time"]),
      temperature: new Set(["temperature"]),
    };
    const allowed = dimensions[semantic] ?? new Set();
    sendJson(response, 200, {
      items: units.filter((unit) => allowed.has(unit.dimension)),
    });
    return;
  }

  if (method === "GET" && path === "/api/cooking-action-types") {
    countRoute("cooking-action-types");
    sendJson(response, 200, { items: [simmerAction] });
    return;
  }

  if (method === "POST" && path === "/api/recipe-drafts") {
    countRoute("recipe-draft-create");
    if (scenario === "slow-draft-creation") {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    sendJson(response, 201, draftDetail(true));
    return;
  }

  const draftPreflightMatch = path.match(
    /^\/api\/recipe-drafts\/([0-9a-f-]+)\/duplicate-preflights$/i,
  );
  if (method === "POST" && draftPreflightMatch?.[1] === IDS.draft) {
    countRoute("draft-duplicate-preflight");
    sendJson(response, 201, probablePreflight);
    return;
  }

  const draftMatch = path.match(/^\/api\/recipe-drafts\/([0-9a-f-]+)$/i);
  if (method === "GET" && draftMatch?.[1] === IDS.draft) {
    countRoute("recipe-draft");
    sendJson(
      response,
      200,
      draftDetail(
        scenario !== "incomplete-draft",
        scenario === "unresolved-draft",
      ),
    );
    return;
  }

  if (method === "GET" && path === "/api/ingredient-requests/mine") {
    countRoute("member-ingredient-requests");
    const requestItems =
      scenario === "homepage-empty"
        ? []
        : scenario === "activity-normal" &&
            url.searchParams.get("reviewed_only") === "true"
          ? activityIngredientRequests
          : [memberIngredientRequest];
    const requestedPageSize = Number.parseInt(
      url.searchParams.get("page_size") ?? "20",
      10,
    );
    sendJson(response, 200, {
      items: requestItems,
      page: 1,
      page_size: requestedPageSize,
      total: requestItems.length,
      total_pages: requestItems.length ? 1 : 0,
    });
    return;
  }

  if (method === "POST" && path === "/api/auth/logout") {
    countRoute("auth-logout");
    scenario = "anonymous-session";
    scenarioState = freshScenarioState();
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }

  if (method === "GET" && path === "/api/ingredient-requests") {
    if (!hasStaffCapability("review_ingredient_requests")) {
      rejectStaffAuthorization(
        response,
        "ingredient-review-authorization-denied",
      );
      return;
    }
    countRoute("ingredient-review-queue");
    const items =
      scenario === "curation-empty" ||
      (scenario === "curation-stale-once" &&
        scenarioState.curationDecisionApplied)
        ? []
        : [ingredientReviewItem];
    sendJson(response, 200, {
      items,
      page: 1,
      page_size: 20,
      total: items.length,
      total_pages: items.length ? 1 : 0,
    });
    return;
  }

  const ingredientReviewMatch = path.match(
    /^\/api\/ingredient-requests\/([0-9a-f-]+)\/review$/i,
  );
  if (
    method === "GET" &&
    ingredientReviewMatch?.[1] === IDS.ingredientRequest
  ) {
    if (!hasStaffCapability("review_ingredient_requests")) {
      rejectStaffAuthorization(
        response,
        "ingredient-review-authorization-denied",
      );
      return;
    }
    countRoute("ingredient-review-detail");
    sendJson(
      response,
      200,
      scenarioState.curationDecisionApplied
        ? reviewedIngredientReviewDetail
        : ingredientReviewDetail,
    );
    return;
  }

  if (
    method === "POST" &&
    ingredientReviewMatch?.[1] === IDS.ingredientRequest
  ) {
    if (!hasStaffCapability("review_ingredient_requests")) {
      rejectStaffAuthorization(
        response,
        "ingredient-review-authorization-denied",
      );
      return;
    }
    countRoute("ingredient-review-decision");
    if (scenario === "curation-stale-once") {
      scenarioState.curationReviewAttempts += 1;
      if (scenarioState.curationReviewAttempts === 1) {
        sendError(
          response,
          409,
          "ingredient_request_conflict",
          "The synthetic request changed before the decision was saved.",
        );
        return;
      }
      scenarioState.curationDecisionApplied = true;
      sendJson(response, 200, reviewedIngredientReviewItem);
      return;
    }
    sendError(
      response,
      409,
      "ingredient_request_conflict",
      "The deterministic fixture accepts decisions only in its reviewed stale-retry scenario.",
    );
    return;
  }

  if (method === "GET" && path === "/api/moderation/recipe-reports") {
    if (!hasStaffCapability("moderate_recipe_reports")) {
      rejectStaffAuthorization(response, "moderation-authorization-denied");
      return;
    }
    countRoute("moderation-queue");
    if (
      scenario === "moderation-queue-failure-once" &&
      scenarioState.moderationQueueAttempts++ === 0
    ) {
      sendError(
        response,
        503,
        "moderation_queue_unavailable",
        "The synthetic moderation queue is temporarily unavailable.",
      );
      return;
    }
    sendJson(response, 200, {
      items: [moderationSummary],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    return;
  }

  const moderationMatch = path.match(
    /^\/api\/moderation\/recipe-reports\/([0-9a-f-]+)$/i,
  );
  if (method === "GET" && moderationMatch?.[1] === IDS.recipeRoot) {
    if (!hasStaffCapability("moderate_recipe_reports")) {
      rejectStaffAuthorization(response, "moderation-authorization-denied");
      return;
    }
    countRoute("moderation-detail");
    if (scenario === "moderation-detail-not-found") {
      sendError(
        response,
        404,
        "moderation_case_not_found",
        "The synthetic moderation case is no longer available.",
      );
      return;
    }
    sendJson(response, 200, moderationDetail);
    return;
  }

  audit.unknown_api_requests += 1;
  sendError(
    response,
    404,
    "baseline_route_not_reviewed",
    "The fixture route is not available.",
  );
}

const server = createServer((request, response) => {
  void (async () => {
    if (!request.socket.remoteAddress?.includes("127.0.0.1")) {
      audit.privacy_rejections += 1;
      sendError(
        response,
        403,
        "baseline_loopback_required",
        "The fixture is loopback-only.",
      );
      return;
    }
    if (request.headers.host !== `127.0.0.1:${port}`) {
      audit.privacy_rejections += 1;
      sendError(
        response,
        421,
        "baseline_host_rejected",
        "The fixture host is not available.",
      );
      return;
    }

    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/__baseline__/health") {
      sendJson(response, 200, { status: "ready" });
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/__baseline__/scenario"
    ) {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 100) break;
      }
      if (!allowedScenarios.has(body)) {
        sendError(
          response,
          400,
          "baseline_scenario_rejected",
          "The fixture scenario is not available.",
        );
        return;
      }
      scenario = body;
      scenarioState = freshScenarioState();
      sendJson(response, 200, { scenario });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__baseline__/audit") {
      sendJson(response, 200, {
        accepted_api_requests: audit.accepted_api_requests,
        unknown_api_requests: audit.unknown_api_requests,
        privacy_rejections: audit.privacy_rejections,
        route_counts: Object.fromEntries(
          Object.entries(audit.route_counts).sort(),
        ),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__baseline__/reset") {
      scenario = "normal";
      audit = freshAudit();
      scenarioState = freshScenarioState();
      sendJson(response, 200, { status: "reset" });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    sendError(
      response,
      404,
      "baseline_control_not_found",
      "The fixture endpoint is not available.",
    );
  })().catch(() => {
    if (!response.headersSent) {
      sendError(
        response,
        500,
        "baseline_fixture_failure",
        "The fixture could not complete the request.",
      );
    } else {
      response.destroy();
    }
  });
});

server.listen(port, host, () => {
  process.stdout.write("RCP-34B synthetic fixture ready.\n");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
