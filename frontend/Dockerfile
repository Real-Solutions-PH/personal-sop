# Stage 0, "deps", install deps once and reuse across stages
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock /app/
COPY frontend/package.json /app/frontend/
# the root workspace manifest lists e2e — bun refuses to run without it
COPY e2e/package.json /app/e2e/
RUN bun install --frozen-lockfile

# Stage "dev", run Next.js dev server with HMR for docker compose watch
FROM oven/bun:1-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json bun.lock /app/
COPY frontend/package.json /app/frontend/
# the root workspace manifest lists e2e — bun refuses to run without it
COPY e2e/package.json /app/e2e/
COPY ./frontend /app/frontend
WORKDIR /app/frontend
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3000
CMD ["bun", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

# Stage 1, "build-stage", build the Next.js app with bun
FROM oven/bun:1-alpine AS build-stage
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json bun.lock /app/
COPY frontend/package.json /app/frontend/
# the root workspace manifest lists e2e — bun refuses to run without it
COPY e2e/package.json /app/e2e/
COPY ./frontend /app/frontend

WORKDIR /app/frontend
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# Stage 1, runtime — Next.js standalone server
FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=build-stage /app/frontend/public ./frontend/public
COPY --from=build-stage --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=build-stage --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "frontend/server.js"]
