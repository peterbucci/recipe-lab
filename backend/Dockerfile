ARG PYTHON_IMAGE=python:3.13-slim@sha256:7ce4b6dfe35e55397b7cda544f8a13f191b7ae28dc5aad71fe664dbc9bc2623f
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.6@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d

FROM ${UV_IMAGE} AS uv
FROM ${PYTHON_IMAGE} AS python-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

FROM python-base AS development

COPY --from=uv /uv /uvx /bin/
WORKDIR /workspace
COPY pyproject.toml uv.lock ./
COPY backend/pyproject.toml backend/README.md ./backend/
COPY ml/pyproject.toml ml/README.md ./ml/
RUN uv sync --locked --package recipe-lab-api --extra dev --no-install-workspace
COPY backend/app ./backend/app
COPY backend/alembic.ini ./backend/
COPY backend/migrations ./backend/migrations
RUN uv sync --locked --package recipe-lab-api --extra dev

ENV PATH=/workspace/.venv/bin:$PATH
WORKDIR /workspace/backend
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM python-base AS production-builder

COPY --from=uv /uv /uvx /bin/
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /workspace
COPY pyproject.toml uv.lock ./
COPY backend/pyproject.toml backend/README.md ./backend/
COPY ml/pyproject.toml ml/README.md ./ml/
RUN uv sync --locked --package recipe-lab-api --no-dev --no-install-workspace --no-editable
COPY backend/app ./backend/app
RUN uv sync --locked --package recipe-lab-api --no-dev --no-editable

FROM python-base AS production

ENV APP_ENVIRONMENT=production \
    PATH=/opt/venv/bin:$PATH \
    PORT=8000

RUN groupadd --system --gid 10001 recipe-lab \
    && useradd --system --uid 10001 --gid recipe-lab --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin recipe-lab \
    && python -m pip uninstall --yes pip setuptools wheel \
    && rm -rf /usr/local/lib/python3.13/ensurepip \
      /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.13

WORKDIR /app
COPY --from=production-builder --chown=recipe-lab:recipe-lab /opt/venv /opt/venv
COPY --chown=recipe-lab:recipe-lab backend/alembic.ini ./
COPY --chown=recipe-lab:recipe-lab backend/migrations ./migrations

USER recipe-lab:recipe-lab
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; port = os.environ.get('PORT', '8000'); response = urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=2); raise SystemExit(0 if response.status == 200 else 1)"]

CMD ["python", "-m", "app.production_server"]
