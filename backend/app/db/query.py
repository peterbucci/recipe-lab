"""Small, shared helpers for building safe database query patterns."""

LIKE_ESCAPE = "\\"


def escape_like_literal(value: str) -> str:
    """Escape a value for a SQL LIKE/ILIKE expression using ``LIKE_ESCAPE``."""

    return value.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2).replace("%", "\\%").replace("_", "\\_")


def literal_contains_pattern(value: str) -> str:
    """Return a contains pattern that treats every character in ``value`` literally."""

    return f"%{escape_like_literal(value)}%"
