"""Operator-managed catalog-curator grants."""

from app.catalog_curators.service import (
    CatalogCuratorOperatorError,
    grant_catalog_curator,
    revoke_catalog_curator,
)

__all__ = [
    "CatalogCuratorOperatorError",
    "grant_catalog_curator",
    "revoke_catalog_curator",
]
