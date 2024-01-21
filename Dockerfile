# https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
FROM node:20.11.0-slim AS base

RUN apt update && \
    apt install openssl -y && \
    apt clean && \
    apt autoclean && \
    apt autoremove

RUN npm install -g prisma

# Install dependencies
FROM base AS deps

WORKDIR /usr/app
COPY package.json package-lock.json* ./

RUN npm ci --ignore-scripts

# https://nextjs.org/docs/messages/sharp-missing-in-production
# https://github.com/vercel/next.js/discussions/35296#discussioncomment-7835217
RUN npm i -g --arch=x64 --platform=linux --libc=glibc sharp

# Build
FROM base AS builder
WORKDIR /usr/app

COPY . .
COPY --from=deps /usr/app/node_modules ./node_modules

RUN prisma generate
RUN npm run build

# Run
FROM base AS runner
WORKDIR /usr/app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_SHARP_PATH=/usr/local/lib/node_modules/sharp

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=deps --chown=nextjs:nodejs /usr/local/lib/node_modules/sharp /usr/local/lib/node_modules/sharp
COPY --from=builder /usr/app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /usr/app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /usr/app/scripts/image-startup.sh ./scripts/
COPY --from=builder --chown=nextjs:nodejs /usr/app/prisma ./prisma

USER nextjs

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["/bin/bash", "-c", "scripts/image-startup.sh"]