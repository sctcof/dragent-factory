FROM node:22-alpine AS builder

WORKDIR /app
ARG NEXT_PUBLIC_API_BASE=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci

COPY apps/web ./apps/web
RUN npm --workspace apps/web run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]

