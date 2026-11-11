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

CMD ["sh", "-c", "npx drizzle-kit push --force --config=src/db/drizzle.config.ts || true; npx tsx server.ts"]
