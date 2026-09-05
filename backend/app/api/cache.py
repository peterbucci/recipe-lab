"""Named response-cache policies for API routes."""

from fastapi import Response

PRIVATE_NO_STORE_HEADERS = {
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
}


def apply_private_no_store(response: Response) -> None:
    """Prevent storage of a response whose representation depends on the member session."""

    response.headers.update(PRIVATE_NO_STORE_HEADERS)


def private_no_store_headers() -> dict[str, str]:
    """Return an independent header mapping for response constructors."""

    return dict(PRIVATE_NO_STORE_HEADERS)
