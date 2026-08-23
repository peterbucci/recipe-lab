from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://recipe_lab:recipe_lab@localhost:5432/recipe_lab"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    app_environment: Literal["local", "test", "production"] = "local"

    auth_allowed_origins: str = ""
    auth_session_ttl_seconds: int = Field(default=14 * 24 * 60 * 60, ge=60)

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
