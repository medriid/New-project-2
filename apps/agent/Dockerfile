FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/agent/package.json apps/agent/package.json
RUN npm install --workspace apps/agent

FROM deps AS build
COPY tsconfig.base.json tsconfig.base.json
COPY apps/agent apps/agent
RUN npm run build -w apps/agent

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-21-jre-headless \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/agent/package.json apps/agent/package.json
COPY --from=build /app/apps/agent/dist apps/agent/dist
CMD ["npm", "run", "start", "-w", "apps/agent"]
