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

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# AI 显式标识需要 ffmpeg + 中文字体
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV AI_LABEL_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
ENV FFMPEG_PATH=ffmpeg
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
