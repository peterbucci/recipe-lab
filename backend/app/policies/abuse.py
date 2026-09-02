"""Declarative route classification for durable abuse controls."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, cast

from app.core.config import Settings

type RateLimitOperation = Literal[
    "account_auth",
    "draft_mutation",
    "fork_creation",
    "publication",
    "recipe_report",
    "interaction",
]
type RateLimitRoutePolicyName = Literal[
    "account_auth_entry",
    "draft_creation",
    "draft_mutation",
    "draft_preflight",
    "publication",
    "reporting",
    "interaction",
]
type RateLimitSettingName = Literal[
    "rate_limit_auth_network",
    "rate_limit_draft_account",
    "rate_limit_draft_network",
    "rate_limit_fork_account",
    "rate_limit_fork_network",
    "rate_limit_publication_account",
    "rate_limit_publication_network",
    "rate_limit_report_account",
    "rate_limit_report_network",
    "rate_limit_interaction_account",
    "rate_limit_interaction_network",
]


@dataclass(frozen=True, slots=True)
class RateLimitPolicy:
    operation: RateLimitOperation
    account_limit: int | None
    network_limit: int


@dataclass(frozen=True, slots=True)
class RateLimitRoutePolicy:
    """One route family and the settings that resolve its durable limits."""

    name: RateLimitRoutePolicyName
    operation: RateLimitOperation
    methods: frozenset[str]
    exact_paths: frozenset[str]
    path_patterns: tuple[re.Pattern[str], ...]
    account_limit_setting: RateLimitSettingName | None
    network_limit_setting: RateLimitSettingName

    def matches(self, *, method: str, path: str) -> bool:
        return method in self.methods and (
            path in self.exact_paths
            or any(pattern.fullmatch(path) is not None for pattern in self.path_patterns)
        )

    def resolve(self, settings: Settings) -> RateLimitPolicy:
        abuse = settings.abuse
        account_limit = (
            cast(int, getattr(abuse, self.account_limit_setting))
            if self.account_limit_setting is not None
            else None
        )
        return RateLimitPolicy(
            operation=self.operation,
            account_limit=account_limit,
            network_limit=cast(int, getattr(abuse, self.network_limit_setting)),
        )


_IDENTIFIER_PATH_PART = r"[^/]{1,64}"
_DRAFT_PATH = re.compile(rf"^/api/recipe-drafts/{_IDENTIFIER_PATH_PART}$")
_DRAFT_PREFLIGHT_PATH = re.compile(
    rf"^/api/recipe-drafts/{_IDENTIFIER_PATH_PART}/duplicate-preflights$"
)
_PUBLICATION_PATH = re.compile(rf"^/api/recipe-drafts/{_IDENTIFIER_PATH_PART}/publish$")
_REPORT_PATH = re.compile(rf"^/api/recipes/{_IDENTIFIER_PATH_PART}/reports$")
_MODERATION_ACTION_PATH = re.compile(
    rf"^/api/moderation/recipe-reports/{_IDENTIFIER_PATH_PART}/actions$"
)
_INTERACTION_PATH = re.compile(rf"^/api/recipes/{_IDENTIFIER_PATH_PART}/(?:view|save|rating)$")
_FOLLOW_PATH = re.compile(rf"^/api/cooks/{_IDENTIFIER_PATH_PART}/follow$")

RATE_LIMIT_ROUTE_POLICIES: tuple[RateLimitRoutePolicy, ...] = (
    RateLimitRoutePolicy(
        name="account_auth_entry",
        operation="account_auth",
        methods=frozenset({"GET"}),
        exact_paths=frozenset(
            {
                "/api/auth/login",
                "/api/auth/reauthenticate",
                "/api/auth/callback",
            }
        ),
        path_patterns=(),
        account_limit_setting=None,
        network_limit_setting="rate_limit_auth_network",
    ),
    RateLimitRoutePolicy(
        name="draft_creation",
        operation="fork_creation",
        methods=frozenset({"POST"}),
        exact_paths=frozenset({"/api/recipe-drafts"}),
        path_patterns=(),
        account_limit_setting="rate_limit_fork_account",
        network_limit_setting="rate_limit_fork_network",
    ),
    RateLimitRoutePolicy(
        name="draft_mutation",
        operation="draft_mutation",
        methods=frozenset({"DELETE", "PUT"}),
        exact_paths=frozenset(),
        path_patterns=(_DRAFT_PATH,),
        account_limit_setting="rate_limit_draft_account",
        network_limit_setting="rate_limit_draft_network",
    ),
    RateLimitRoutePolicy(
        name="draft_preflight",
        operation="draft_mutation",
        methods=frozenset({"POST"}),
        exact_paths=frozenset(),
        path_patterns=(_DRAFT_PREFLIGHT_PATH,),
        account_limit_setting="rate_limit_draft_account",
        network_limit_setting="rate_limit_draft_network",
    ),
    RateLimitRoutePolicy(
        name="publication",
        operation="publication",
        methods=frozenset({"POST"}),
        exact_paths=frozenset(),
        path_patterns=(_PUBLICATION_PATH,),
        account_limit_setting="rate_limit_publication_account",
        network_limit_setting="rate_limit_publication_network",
    ),
    RateLimitRoutePolicy(
        name="reporting",
        operation="recipe_report",
        methods=frozenset({"POST"}),
        exact_paths=frozenset(),
        path_patterns=(_REPORT_PATH, _MODERATION_ACTION_PATH),
        account_limit_setting="rate_limit_report_account",
        network_limit_setting="rate_limit_report_network",
    ),
    RateLimitRoutePolicy(
        name="interaction",
        operation="interaction",
        methods=frozenset({"DELETE", "POST", "PUT"}),
        exact_paths=frozenset(),
        path_patterns=(_INTERACTION_PATH, _FOLLOW_PATH),
        account_limit_setting="rate_limit_interaction_account",
        network_limit_setting="rate_limit_interaction_network",
    ),
)


def match_rate_limit_route(*, method: str, path: str) -> RateLimitRoutePolicy | None:
    """Return the declaration for one normalized request, if it is protected."""

    normalized_method = method.upper()
    normalized_path = path.rstrip("/") or "/"
    return next(
        (
            policy
            for policy in RATE_LIMIT_ROUTE_POLICIES
            if policy.matches(method=normalized_method, path=normalized_path)
        ),
        None,
    )


def classify_rate_limited_request(
    *,
    method: str,
    path: str,
    settings: Settings,
) -> RateLimitPolicy | None:
    """Resolve a protected route declaration against current limit settings."""

    route_policy = match_rate_limit_route(method=method, path=path)
    return route_policy.resolve(settings) if route_policy is not None else None
