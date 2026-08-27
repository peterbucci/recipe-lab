from collections.abc import MutableSequence

from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.observability import (
    CORRELATION_ID_HEADER,
    CORRELATION_ID_STATE_KEY,
    emit_operational_failure,
    new_correlation_id,
    request_failure_event,
)


class PrivacySafeObservabilityMiddleware:
    """Correlate requests and fail safely without retaining request or exception data."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def _replace_correlation_header(
        headers: MutableSequence[tuple[bytes, bytes]],
        correlation_id: str,
    ) -> None:
        header_name = CORRELATION_ID_HEADER.lower().encode("ascii")
        headers[:] = [item for item in headers if item[0].lower() != header_name]
        headers.append((header_name, correlation_id.encode("ascii")))

    @staticmethod
    async def _send_safe_failure(
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        code: str,
        message: str,
        correlation_id: str,
    ) -> None:
        response = JSONResponse(
            status_code=status_code,
            content={
                "error": {
                    "code": code,
                    "message": message,
                    "issues": [],
                    "correlation_id": correlation_id,
                }
            },
            headers={CORRELATION_ID_HEADER: correlation_id},
        )
        await response(scope, receive, send)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        correlation_id = new_correlation_id()
        state = scope.setdefault("state", {})
        if not isinstance(state, dict):
            state = dict(state)
            scope["state"] = state
        state[CORRELATION_ID_STATE_KEY] = correlation_id
        response_started = False
        response_complete = False

        async def send_with_correlation(message: Message) -> None:
            nonlocal response_complete, response_started
            if message.get("type") == "http.response.start":
                response_started = True
                raw_headers = message.setdefault("headers", [])
                if isinstance(raw_headers, list):
                    self._replace_correlation_header(raw_headers, correlation_id)
            elif message.get("type") == "http.response.body" and not message.get(
                "more_body", False
            ):
                response_complete = True
            await send(message)

        async def finish_started_response() -> None:
            if not response_complete:
                await send({"type": "http.response.body", "body": b"", "more_body": False})

        try:
            await self.app(scope, receive, send_with_correlation)
        except SQLAlchemyError:
            emit_operational_failure("database_failure", correlation_id=correlation_id)
            if response_started:
                await finish_started_response()
                return
            await self._send_safe_failure(
                scope,
                receive,
                send_with_correlation,
                status_code=503,
                code="dependency_unavailable",
                message="A required service dependency is temporarily unavailable.",
                correlation_id=correlation_id,
            )
        except Exception:
            emit_operational_failure(
                request_failure_event(scope),
                correlation_id=correlation_id,
            )
            if response_started:
                await finish_started_response()
                return
            await self._send_safe_failure(
                scope,
                receive,
                send_with_correlation,
                status_code=500,
                code="internal_error",
                message="The service could not complete the request.",
                correlation_id=correlation_id,
            )
