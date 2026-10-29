# Node.js 22 LTS on Debian slim. The build stage compiles the frontend and
# better-sqlite3. The final image keeps production dependencies only.
# The process starts as root so it can chown the Fly volume, then drops to uid 1001.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:${PATH}" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
    && pnpm --filter @ai-use/server deploy --prod --legacy /prod

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.sqlite \
    UPLOAD_DIR=/data/uploads \
    STATIC_DIR=/app/dist \
    SAMPLE_TEMPLATE_PATH=/app/public/samples/field-note.docx \
    TRUST_PROXY=true
WORKDIR /app
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid 1001 --home-dir /app --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown app:app /data
COPY --from=build /prod /app/server
COPY --from=build /app/dist /app/dist
COPY --from=build /app/public/samples /app/public/samples
RUN chown -R app:app /app
EXPOSE 3000
CMD ["node", "/app/server/src/index.ts"]
