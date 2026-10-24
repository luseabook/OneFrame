FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @app/shared build \
 && pnpm --filter @app/db build \
 && pnpm --filter @app/storage build \
 && pnpm --filter @app/model-adapters build \
 && pnpm --filter @app/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
