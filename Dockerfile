FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    AMUNET_SERVE_STATIC=1 \
    AMUNET_PREWARM=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY THIRD_PARTY_NOTICES.md README.md ./

EXPOSE 8080/tcp
EXPOSE 19132/udp

CMD ["npm", "start"]
