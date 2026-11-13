# BC OpenBridge – keine Laufzeit-Abhängigkeiten, TypeScript läuft nativ in Node 24.
# Für reproduzierbare Builds das Basis-Image per Digest pinnen (node:24-alpine@sha256:…).
FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src
COPY --chown=root:root scripts ./scripts

# Schreibbar nur das Datenverzeichnis (Audit-Log); Code gehört root und ist read-only.
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "src/main.ts"]
