ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

FROM ${NODE_IMAGE} AS base
# Fix CVE-2026-14456 until the official Node base includes patched OpenSSL.
RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build \
    && rm -rf .next/cache .next/diagnostics .next/turbopack .next/types \
    && rm -f .next/trace .next/trace-build

FROM base AS production-dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && rm -rf node_modules/@playwright node_modules/playwright node_modules/playwright-core

FROM base AS production

ENV APP_ENVIRONMENT=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    PORT=3000

RUN addgroup --system --gid 10001 nodejs \
    && adduser --system --uid 10001 --ingroup nodejs --home /nonexistent nextjs \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/.next ./.next
COPY --chown=nextjs:nodejs package.json next.config.ts server.mjs ./
COPY --chown=nextjs:nodejs server/runtime-config.mjs server/trusted-network-signal.mjs ./server/

USER nextjs:nodejs
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const port = process.env.PORT || '3000'; fetch(`http://127.0.0.1:${port}/healthz`).then(async (response) => { if (response.status !== 200 || await response.text() !== 'ok\\n') process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "server.mjs", "--hostname", "0.0.0.0"]
