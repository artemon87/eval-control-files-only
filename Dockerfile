FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS build
ARG NEXT_PUBLIC_EVAL_API_URL
ARG NEXT_PUBLIC_GITHUB_MANIFEST_BASE_URL
ENV NEXT_PUBLIC_EVAL_API_URL=$NEXT_PUBLIC_EVAL_API_URL
ENV NEXT_PUBLIC_GITHUB_MANIFEST_BASE_URL=$NEXT_PUBLIC_GITHUB_MANIFEST_BASE_URL
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.openai ./.openai
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/vite.config.ts ./vite.config.ts
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/vinext", "start", "--host", "0.0.0.0", "--port", "3000"]
