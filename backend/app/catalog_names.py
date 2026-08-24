import unicodedata
from hashlib import sha256

from sqlalchemy import text
from sqlalchemy.orm import Session


def normalize_catalog_name(value: str) -> str:
    """Return the conservative candidate key shared by seed and runtime writes.

    This normalization identifies namespace collision candidates only. It never
    establishes semantic ingredient identity by itself.
    """

    compatibility_normalized = unicodedata.normalize("NFKC", value)
    return " ".join(compatibility_normalized.split()).casefold()


def catalog_name_digest(normalized_name: str) -> str:
    return sha256(normalized_name.encode("utf-8")).hexdigest()


def lock_catalog_names(session: Session, normalized_names: set[str]) -> None:
    """Serialize cross-table canonical/alias namespace checks without deadlocks."""

    statement = text(
        "SELECT pg_advisory_xact_lock("
        "hashtextextended('ingredient-catalog-name:' || :normalized_name, CAST(0 AS bigint)))"
    )
    for normalized_name in sorted(normalized_names):
        session.execute(statement, {"normalized_name": normalized_name})
