FROM node:20-alpine AS build
WORKDIR /app
COPY apps/miniapp/package*.json ./
RUN npm ci
COPY apps/miniapp ./
RUN npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/app
