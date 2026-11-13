# The dispatcher. Node 22.18+ runs the TypeScript sources directly (type stripping), so there's no build step.
FROM docker:29-cli AS docker

# The dashboard page (React + Tailwind), built once here; only its static files reach the final image.
FROM node:22-trixie-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build:web

FROM node:22-trixie-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1
# The docker CLI only: the dispatcher starts agent containers through the host's socket.
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY templates ./templates
COPY --from=web /app/web/dist ./web/dist
USER node
CMD ["node", "src/main.ts", "serve"]
