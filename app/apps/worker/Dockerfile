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
 && pnpm --filter @app/worker build

# 生产依赖：按同一 lockfile 重装 --prod（同 api/Dockerfile 的理由）
FROM build AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# AI 显式标识需要 ffmpeg + 中文字体
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
# 只带运行所需（H-5）：生产依赖 + workspace 包 + worker 构建产物
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
# pnpm 非扁平：worker 的直接依赖在 apps/worker/node_modules 里
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
RUN mkdir -p /app/tmp && chown -R node:node /app
ENV AI_LABEL_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
ENV FFMPEG_PATH=ffmpeg
# 非 root 运行（H-4）
USER node
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]