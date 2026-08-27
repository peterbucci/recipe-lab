from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
