# Base image
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Dependencies stage
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
# Preferir npm (package-lock) si existe; si no, pnpm
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; \
    else corepack enable && pnpm install --ignore-scripts; fi

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Subpath en sistemas.mopc.gov.py (override con --build-arg BASE_PATH=)
ARG BASE_PATH=/prototipo_vmt
ENV BASE_PATH=$BASE_PATH
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN if [ -f package-lock.json ]; then npm run build; else corepack enable && pnpm run build; fi

# Runner stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ARG BASE_PATH=/prototipo_vmt
ENV BASE_PATH=$BASE_PATH
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
