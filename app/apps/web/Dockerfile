FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @app/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV NITRO_PORT=3001
COPY --from=build /app/apps/web/.output ./.output
COPY --from=build /app/apps/web/package.json ./package.json
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
