FROM node:20-alpine AS build
WORKDIR /build

COPY apps/miniapp/package*.json ./miniapp/
RUN cd miniapp && npm ci
COPY apps/miniapp ./miniapp
RUN cd miniapp && npm run build

COPY apps/admin/package*.json ./admin/
RUN cd admin && npm ci
COPY apps/admin ./admin
RUN cd admin && npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/miniapp/dist /srv/app
COPY --from=build /build/admin/dist /srv/admin
