import { createServer } from "node:http";

const host = process.env.BASELINE_FIXTURE_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.BASELINE_FIXTURE_PORT ?? "4318", 10);
if (host !== "127.0.0.1" || port !== 4318) {
  throw new Error("The RCP-34B fixture must use its reviewed loopback origin.");
}

const FIXED_TIME = "2026-08-27T12:00:00.000Z";
const SAFE_CSRF = "rcp34b-public-csrf";
const SAFE_COOKIE = `recipe_lab_csrf=${SAFE_CSRF}`;
const IDS = Object.freeze({
  user: "10000000-0000-4000-8000-000000000001",
  catalogUser: "10000000-0000-4000-8000-000000000002",
  recipeRoot: "20000000-0000-4000-8000-000000000001",
  recipeVariant: "20000000-0000-4000-8000-000000000002",
  recipeChild: "20000000-0000-4000-8000-000000000003",
  lineage: "20000000-0000-4000-8000-000000000010",
  draft: "30000000-0000-4000-8000-000000000001",
  draftIngredient: "30000000-0000-4000-8000-000000000011",
  draftInstruction: "30000000-0000-4000-8000-000000000021",
  draftAction: "30000000-0000-4000-8000-000000000031",
  tomato: "40000000-0000-4000-8000-000000000001",
  basil: "40000000-0000-4000-8000-000000000002",
  gram: "50000000-0000-4000-8000-000000000001",
  minute: "50000000-0000-4000-8000-000000000002",
  celsius: "50000000-0000-4000-8000-000000000003",
  simmer: "60000000-0000-4000-8000-000000000001",
  ingredientRequest: "70000000-0000-4000-8000-000000000001",
  approvedRequest: "70000000-0000-4000-8000-000000000002",
  report: "80000000-0000-4000-8000-000000000001",
  preflight: "90000000-0000-4000-8000-000000000001",
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
const session = Object.freeze({
  status: "authenticated",
  user,
  capabilities: {
    moderate_recipe_reports: true,
    review_ingredient_requests: true,
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
  { ...gramSummary, aliases: ["grams"], provenance: "Synthetic baseline catalog." },
  { ...minuteSummary, aliases: ["minutes"], provenance: "Synthetic baseline catalog." },
  { ...celsiusSummary, aliases: ["Celsius"], provenance: "Synthetic baseline catalog." },
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

function recipeSummary({
  id,
  parentVersionId,
  versionNumber,
  title,
  description,
  author = user,
  parent = null,
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
    author,
    parent,
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
  }),
);
const childSummary = Object.freeze(
  recipeSummary({
    id: IDS.recipeChild,
    parentVersionId: IDS.recipeVariant,
    versionNumber: 3,
    title: "Roasted Garden Tomato Soup",
    description: "A roasted variation with a deeper tomato flavor.",
    parent: {
      id: IDS.recipeVariant,
      version_number: 2,
      title: variantSummary.title,
      author: user,
    },
  }),
);

function detailFor(summary) {
  const isRoot = summary.id === IDS.recipeRoot;
  return {
    ...summary,
    average_rating: isRoot ? 4.8 : 4.5,
    rating_count: isRoot ? 12 : 8,
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
          text: "Simmer the tomatoes until soft.",
          display_order: 0,
          actions: [],
        },
        after: detailFor(variantSummary).instructions[0],
        changed_fields: ["text", "actions"],
      },
    ],
  },
  has_changes: true,
});

function draftDetail(complete, unresolvedIngredient = false) {
  return {
    id: IDS.draft,
    source_version_id: null,
    status: "active",
    revision: 4,
    title: complete ? "Late-Summer Tomato Pot" : "",
    description: complete ? "A small-batch soup for a shared table." : null,
    servings: complete ? "4" : null,
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
  "anonymous-session",
  "normal",
  "slow-draft-creation",
  "incomplete-draft",
  "unresolved-draft",
  "library-failure",
  "expired-library",
  "public-context-failure",
  "slow-session",
]);
let scenario = "normal";
let audit = freshAudit();

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

function apiPage(items) {
  return {
    items,
    page: 1,
    page_size: 12,
    total: items.length,
    total_pages: items.length ? 1 : 0,
  };
}

async function handleApi(request, response, url) {
  if (requestHasPrivateMaterial(request)) {
    audit.privacy_rejections += 1;
    sendError(response, 400, "baseline_private_material_rejected", "The fixture rejected this request.");
    return;
  }

  const method = request.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/api/auth/session") {
    countRoute("auth-session");
    if (scenario === "slow-session") {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    sendJson(
      response,
      200,
      scenario === "anonymous-session" ? { status: "anonymous" } : session,
    );
    return;
  }

  if (method === "GET" && path === "/api/recipes") {
    countRoute("recipe-catalog");
    const query = url.searchParams.get("q")?.trim() ?? "";
    const variant = url.searchParams.get("is_variant");
    let items = query === "No baseline matches" ? [] : [rootSummary, variantSummary, childSummary];
    if (variant === "true") items = items.filter((item) => item.parent_version_id !== null);
    if (variant === "false") items = items.filter((item) => item.parent_version_id === null);
    sendJson(response, 200, apiPage(items));
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
    sendJson(response, 200, {
      ...apiPage([variantSummary, childSummary]),
      cook: user,
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
  if (method === "POST" && viewMatch && [IDS.recipeRoot, IDS.recipeVariant, IDS.recipeChild].includes(viewMatch[1])) {
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

  if (method === "GET" && path === "/api/my/recipes") {
    countRoute("my-recipes");
    if (scenario === "library-failure") {
      sendError(response, 503, "baseline_service_unavailable", "The synthetic recipe library is temporarily unavailable.");
      return;
    }
    if (scenario === "expired-library") {
      sendError(response, 401, "session_expired", "Your session expired. Sign in again to continue.");
      return;
    }
    const view = url.searchParams.get("view");
    const itemsByView = {
      drafts: [{ kind: "draft", draft: draftListItem }],
      published: [
        { kind: "published", recipe: rootSummary, visibility_state: "published" },
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
    const items = itemsByView[view];
    if (!items) {
      sendError(
        response,
        422,
        "validation_error",
        "Choose drafts, published, or withdrawn.",
      );
      return;
    }
    sendJson(response, 200, {
      items,
      page: 1,
      page_size: 12,
      total: items.length,
      total_pages: 1,
    });
    return;
  }

  if (method === "GET" && path === "/api/my/saved-recipes") {
    countRoute("saved-recipes");
    sendJson(response, 200, {
      items: [{ recipe: variantSummary, saved_at: FIXED_TIME }],
      page: 1,
      page_size: 12,
      total: 1,
      total_pages: 1,
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
    sendJson(response, 200, { items: units.filter((unit) => allowed.has(unit.dimension)) });
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
    sendJson(response, 200, {
      items: [memberIngredientRequest],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    return;
  }

  if (method === "GET" && path === "/api/ingredient-requests") {
    countRoute("ingredient-review-queue");
    sendJson(response, 200, {
      items: [ingredientReviewItem],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    return;
  }

  const ingredientReviewMatch = path.match(
    /^\/api\/ingredient-requests\/([0-9a-f-]+)\/review$/i,
  );
  if (method === "GET" && ingredientReviewMatch?.[1] === IDS.ingredientRequest) {
    countRoute("ingredient-review-detail");
    sendJson(response, 200, ingredientReviewDetail);
    return;
  }

  if (method === "GET" && path === "/api/moderation/recipe-reports") {
    countRoute("moderation-queue");
    sendJson(response, 200, {
      items: [moderationSummary],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    });
    return;
  }

  const moderationMatch = path.match(/^\/api\/moderation\/recipe-reports\/([0-9a-f-]+)$/i);
  if (method === "GET" && moderationMatch?.[1] === IDS.recipeRoot) {
    countRoute("moderation-detail");
    sendJson(response, 200, moderationDetail);
    return;
  }

  audit.unknown_api_requests += 1;
  sendError(response, 404, "baseline_route_not_reviewed", "The fixture route is not available.");
}

const server = createServer((request, response) => {
  void (async () => {
    if (!request.socket.remoteAddress?.includes("127.0.0.1")) {
      audit.privacy_rejections += 1;
      sendError(response, 403, "baseline_loopback_required", "The fixture is loopback-only.");
      return;
    }
    if (request.headers.host !== `127.0.0.1:${port}`) {
      audit.privacy_rejections += 1;
      sendError(response, 421, "baseline_host_rejected", "The fixture host is not available.");
      return;
    }

    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/__baseline__/health") {
      sendJson(response, 200, { status: "ready" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__baseline__/scenario") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 100) break;
      }
      if (!allowedScenarios.has(body)) {
        sendError(response, 400, "baseline_scenario_rejected", "The fixture scenario is not available.");
        return;
      }
      scenario = body;
      sendJson(response, 200, { scenario });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__baseline__/audit") {
      sendJson(response, 200, {
        accepted_api_requests: audit.accepted_api_requests,
        unknown_api_requests: audit.unknown_api_requests,
        privacy_rejections: audit.privacy_rejections,
        route_counts: Object.fromEntries(Object.entries(audit.route_counts).sort()),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__baseline__/reset") {
      scenario = "normal";
      audit = freshAudit();
      sendJson(response, 200, { status: "reset" });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    sendError(response, 404, "baseline_control_not_found", "The fixture endpoint is not available.");
  })().catch(() => {
    if (!response.headersSent) {
      sendError(response, 500, "baseline_fixture_failure", "The fixture could not complete the request.");
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
