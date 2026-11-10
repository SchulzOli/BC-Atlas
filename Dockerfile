FROM node:24-alpine

LABEL org.opencontainers.image.title="BC Atlas" \
      org.opencontainers.image.description="Architecture diagrams, health checks, and documentation for Business Central AL" \
      org.opencontainers.image.source="https://github.com/SchulzOli/BC-Atlas" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY vendor ./vendor
COPY schemas ./schemas
# Built-in plugins: manifest and code only (.dockerignore keeps out their AL apps, tests, and e2e runs).
COPY plugins ./plugins
COPY LICENSE THIRD_PARTY_NOTICES.md README.md ./

USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["--help"]
