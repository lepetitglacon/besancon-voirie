# Image de production de Besançon Voirie, deux cibles construites depuis la racine du monorepo :
#   - api : API NestJS, applique les migrations drizzle au démarrage ;
#   - web : front Vite compilé, servi par nginx qui relaie /api vers l'API.
# Utilisée par docker-compose.prod.yml (déploiement Dokploy).

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# Installation et compilation de tout le monorepo (paquets partagés, API, front)
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build:packages \
 && pnpm --filter api build \
 && pnpm --filter web build

# API : garde les dépendances de développement pour drizzle-kit (migrations au démarrage)
FROM base AS api
ENV NODE_ENV=production API_PORT=3000
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && node dist/main"]

# Front : fichiers statiques + relais /api
FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
