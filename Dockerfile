# Allientic Checkout — Production Self-Hosted Dockerfile (Easypanel & Docker Ready)
# Target Domain: https://checkout.xperiserv.in

FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["npx", "tsx", "server.ts"]
