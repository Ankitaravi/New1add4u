# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev --ignore-scripts

# ---- run ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/package.json ./
USER node
EXPOSE 3000
# Apply pending migrations, then start. `migrate deploy` is safe to run on every boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
