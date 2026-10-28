# Full image for the build stage: it has make/g++ if better-sqlite3's prebuilt binary is missing
# for the target architecture. The runtime stage stays glibc (never alpine/musl).
FROM node:20 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
WORKDIR /srv
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/lib/db/migrations ./lib/db/migrations
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
