from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ConcernSettings(BaseModel):
    """Immutable, domain-focused view over environment-backed settings."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DatabaseSettings(ConcernSettings):
    url: str
    operation_timeout_seconds: int


class HttpSettings(ConcernSettings):
    environment: Literal["local", "test", "production"]
    cors_origins: tuple[str, ...]
    max_request_body_bytes: int


class SessionSettings(ConcernSettings):
    allowed_origins: tuple[str, ...]
    cookie_secure: bool
    recent_ttl_seconds: int
    touch_interval_seconds: int
    ttl_seconds: int


class OidcSettings(ConcernSettings):
    allowed_signing_algorithms: tuple[str, ...]
    client_id: str
    client_secret: SecretStr | None
    clock_skew_seconds: int
    http_timeout_seconds: float
    issuer: str
    login_ttl_seconds: int
    redirect_uri: str
    scopes: tuple[str, ...]


class AbuseSettings(ConcernSettings):
    internal_network_signal_secret: SecretStr
    internal_network_signal_ttl_seconds: int
    rate_limit_auth_identity: int
    rate_limit_auth_network: int
    rate_limit_draft_account: int
    rate_limit_draft_network: int
    rate_limit_fork_account: int
    rate_limit_fork_network: int
    rate_limit_interaction_account: int
    rate_limit_interaction_network: int
    rate_limit_publication_account: int
    rate_limit_publication_network: int
    rate_limit_report_account: int
    rate_limit_report_network: int
    rate_limit_secret: SecretStr
    rate_limit_window_seconds: int


class ResearchSettings(ConcernSettings):
    recommendation_max_candidates: int
    recommendation_max_profile_records: int


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
    database_operation_timeout_seconds: int = Field(default=5, ge=1, le=30)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    app_environment: Literal["local", "test", "production"] = "local"

    auth_allowed_origins: str = ""
    auth_session_ttl_seconds: int = Field(default=14 * 24 * 60 * 60, ge=60)
    auth_session_touch_interval_seconds: int = Field(default=5 * 60, ge=0, le=24 * 60 * 60)
    auth_recent_ttl_seconds: int = Field(default=10 * 60, ge=60, le=60 * 60)

    max_request_body_bytes: int = Field(default=2 * 1024 * 1024, ge=1024, le=16 * 1024 * 1024)
    abuse_rate_limit_secret: SecretStr = SecretStr("recipe-lab-local-development-rate-limit-secret")
    internal_network_signal_secret: SecretStr = SecretStr(
        "recipe-lab-local-internal-network-signal-secret"
    )
    internal_network_signal_ttl_seconds: int = Field(default=30, ge=5, le=5 * 60)
    abuse_rate_limit_window_seconds: int = Field(default=60, ge=1, le=60 * 60)
    abuse_rate_limit_auth_network: int = Field(default=120, ge=1, le=100_000)
    abuse_rate_limit_auth_identity: int = Field(default=30, ge=1, le=100_000)
    abuse_rate_limit_draft_account: int = Field(default=120, ge=1, le=100_000)
    abuse_rate_limit_draft_network: int = Field(default=600, ge=1, le=100_000)
    abuse_rate_limit_fork_account: int = Field(default=30, ge=1, le=100_000)
    abuse_rate_limit_fork_network: int = Field(default=120, ge=1, le=100_000)
    abuse_rate_limit_publication_account: int = Field(default=30, ge=1, le=100_000)
    abuse_rate_limit_publication_network: int = Field(default=120, ge=1, le=100_000)
    abuse_rate_limit_report_account: int = Field(default=30, ge=1, le=100_000)
    abuse_rate_limit_report_network: int = Field(default=120, ge=1, le=100_000)
    abuse_rate_limit_interaction_account: int = Field(default=600, ge=1, le=100_000)
    abuse_rate_limit_interaction_network: int = Field(default=2_400, ge=1, le=100_000)

    recommendation_max_candidates: int = Field(default=2_000, ge=50, le=50_000)
    recommendation_max_profile_records: int = Field(default=5_000, ge=50, le=100_000)

    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: SecretStr | None = None
    oidc_redirect_uri: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_allowed_signing_algorithms: str = "RS256"
    oidc_login_ttl_seconds: int = Field(default=10 * 60, ge=60, le=60 * 60)
    oidc_http_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    oidc_clock_skew_seconds: int = Field(default=30, ge=0, le=5 * 60)

    @field_validator("oidc_client_secret", mode="before")
    @classmethod
    def empty_oidc_secret_is_absent(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("abuse_rate_limit_secret")
    @classmethod
    def rate_limit_secret_has_sufficient_entropy(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("ABUSE_RATE_LIMIT_SECRET must contain at least 32 characters.")
        return value

    @field_validator("internal_network_signal_secret")
    @classmethod
    def internal_network_secret_has_sufficient_entropy(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("INTERNAL_NETWORK_SIGNAL_SECRET must contain at least 32 characters.")
        return value

    @model_validator(mode="after")
    def production_uses_private_abuse_secrets(self) -> "Settings":
        if (
            self.app_environment == "production"
            and self.abuse_rate_limit_secret.get_secret_value()
            == "recipe-lab-local-development-rate-limit-secret"
        ):
            raise ValueError("ABUSE_RATE_LIMIT_SECRET must be configured in production.")
        if (
            self.app_environment == "production"
            and self.internal_network_signal_secret.get_secret_value()
            == "recipe-lab-local-internal-network-signal-secret"
        ):
            raise ValueError("INTERNAL_NETWORK_SIGNAL_SECRET must be configured in production.")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def auth_allowed_origin_list(self) -> list[str]:
        configured = [
            origin.strip() for origin in self.auth_allowed_origins.split(",") if origin.strip()
        ]
        return configured or self.cors_origin_list

    @property
    def auth_cookie_secure(self) -> bool:
        return self.app_environment != "local"

    @property
    def oidc_scope_list(self) -> list[str]:
        return list(dict.fromkeys(scope for scope in self.oidc_scopes.split() if scope))

    @property
    def oidc_allowed_signing_algorithm_list(self) -> list[str]:
        return [
            algorithm.strip()
            for algorithm in self.oidc_allowed_signing_algorithms.split(",")
            if algorithm.strip()
        ]

    @property
    def database(self) -> DatabaseSettings:
        return DatabaseSettings(
            url=self.database_url,
            operation_timeout_seconds=self.database_operation_timeout_seconds,
        )

    @property
    def http(self) -> HttpSettings:
        return HttpSettings(
            environment=self.app_environment,
            cors_origins=tuple(self.cors_origin_list),
            max_request_body_bytes=self.max_request_body_bytes,
        )

    @property
    def session(self) -> SessionSettings:
        return SessionSettings(
            allowed_origins=tuple(self.auth_allowed_origin_list),
            cookie_secure=self.auth_cookie_secure,
            recent_ttl_seconds=self.auth_recent_ttl_seconds,
            touch_interval_seconds=self.auth_session_touch_interval_seconds,
            ttl_seconds=self.auth_session_ttl_seconds,
        )

    @property
    def oidc(self) -> OidcSettings:
        return OidcSettings(
            allowed_signing_algorithms=tuple(self.oidc_allowed_signing_algorithm_list),
            client_id=self.oidc_client_id,
            client_secret=self.oidc_client_secret,
            clock_skew_seconds=self.oidc_clock_skew_seconds,
            http_timeout_seconds=self.oidc_http_timeout_seconds,
            issuer=self.oidc_issuer,
            login_ttl_seconds=self.oidc_login_ttl_seconds,
            redirect_uri=self.oidc_redirect_uri,
            scopes=tuple(self.oidc_scope_list),
        )

    @property
    def abuse(self) -> AbuseSettings:
        return AbuseSettings(
            internal_network_signal_secret=self.internal_network_signal_secret,
            internal_network_signal_ttl_seconds=self.internal_network_signal_ttl_seconds,
            rate_limit_auth_identity=self.abuse_rate_limit_auth_identity,
            rate_limit_auth_network=self.abuse_rate_limit_auth_network,
            rate_limit_draft_account=self.abuse_rate_limit_draft_account,
            rate_limit_draft_network=self.abuse_rate_limit_draft_network,
            rate_limit_fork_account=self.abuse_rate_limit_fork_account,
            rate_limit_fork_network=self.abuse_rate_limit_fork_network,
            rate_limit_interaction_account=self.abuse_rate_limit_interaction_account,
            rate_limit_interaction_network=self.abuse_rate_limit_interaction_network,
            rate_limit_publication_account=self.abuse_rate_limit_publication_account,
            rate_limit_publication_network=self.abuse_rate_limit_publication_network,
            rate_limit_report_account=self.abuse_rate_limit_report_account,
            rate_limit_report_network=self.abuse_rate_limit_report_network,
            rate_limit_secret=self.abuse_rate_limit_secret,
            rate_limit_window_seconds=self.abuse_rate_limit_window_seconds,
        )

    @property
    def research(self) -> ResearchSettings:
        return ResearchSettings(
            recommendation_max_candidates=self.recommendation_max_candidates,
            recommendation_max_profile_records=self.recommendation_max_profile_records,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
