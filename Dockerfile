FROM node:24-slim AS base

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build:server

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    HOARDR_DATA_DIR=/data

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json

RUN mkdir /data && chown node:node /data \
    && ln -s /app/build/cli.js /usr/local/bin/hoardr
USER node
EXPOSE 3000

ENTRYPOINT ["hoardr"]
CMD ["serve"]
