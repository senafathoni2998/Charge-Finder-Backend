# ---- Build stage: compile TypeScript to dist/ (needs devDependencies) ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production dependencies + compiled output only ----
FROM node:20-alpine AS runtime

WORKDIR /app

# Activates Secure session cookies + HSTS + strict CORS (see app.ts / session.ts).
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Runs the compiled JS directly — no ts-node / nodemon in production.
CMD ["node", "dist/app.js"]
