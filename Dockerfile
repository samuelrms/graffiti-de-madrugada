# ---- build: TypeScript server + Vite client ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile
ARG VITE_PUBLIC_URL=https://graffitidemadrugada.samuelramos.dev
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
COPY tsconfig*.json vite.config.ts .env ./
COPY src ./src
RUN pnpm build

# ---- runtime: only production deps + dist ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server/server/index.js"]
