FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY fun-launch/package.json fun-launch/pnpm-lock.yaml ./fun-launch/
RUN pnpm --dir fun-launch install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=/demo
RUN pnpm --dir fun-launch build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "scripts/serve.mjs", "start"]
