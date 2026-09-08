# Costumes & Set - single-container production image (API + built web app)
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd backend && npm ci && cd ../frontend && npm ci
COPY backend backend
COPY frontend frontend
RUN cd frontend && npm run build
RUN cd backend && npx prisma generate && npm run build && npm prune --omit=dev

FROM node:20-alpine
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=4000 DATA_DIR=/data CORS_ORIGIN=*
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/scripts ./scripts
COPY --from=build /app/frontend/dist /app/frontend/dist
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["sh", "./scripts/start.sh"]
