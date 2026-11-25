FROM node:20-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates libargon2-1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node

FROM build AS migration
CMD ["npm", "run", "prisma:migrate:deploy"]

FROM runtime AS worker
CMD ["node", "dist/worker/index.js"]

FROM runtime AS api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/api/server.js"]
