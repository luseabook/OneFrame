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

# 迁移/播种专用目标：drizzle-kit + tsx + src 都在这里（属 devDependencies）。
# docker-compose.prod.yml 的 migrate 服务用 `target: migrate` 构建；
# 生产 runtime 镜像刻意不含这些工具与源码。
FROM build AS migrate
WORKDIR /app/apps/api

# 生产依赖：按同一 lockfile 重装 --prod，devDependencies 不进运行时镜像
FROM build AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 只带运行所需：生产依赖 + workspace 包（含 dist） + api 构建产物。
# 不再 COPY 整个工作区 —— 旧写法会把全部源码、测试、.env.example 和
# devDependencies（tsx/vitest/tsc/eslint）打进运行时镜像。
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# pnpm 非扁平：api 的直接依赖（@nestjs 等）在 apps/api/node_modules 里，
# 只拷根 node_modules 会在启动时 MODULE_NOT_FOUND。
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
RUN chown -R node:node /app
# 非 root 运行（node 镜像自带 uid=1000 的 node 用户）
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]