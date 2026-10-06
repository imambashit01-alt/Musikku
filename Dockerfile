FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

COPY client client
COPY server server
RUN npm run build

FROM node:24-bookworm-slim AS production-deps

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  PORT=3001 \
  DATA_DIRECTORY=/data \
  DATABASE_PATH=/data/musikku.sqlite

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY --from=production-deps /app/node_modules node_modules
RUN mkdir -p /data

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

VOLUME ["/data"]
EXPOSE 3001
CMD ["npm", "start"]
