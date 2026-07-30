FROM node:22-alpine

LABEL org.opencontainers.image.title="BC Atlas" \
      org.opencontainers.image.description="Architecture diagrams and executable documentation for Business Central AL" \
      org.opencontainers.image.source="https://github.com/SchulzOli/ALD2Tree" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY vendor ./vendor
COPY LICENSE THIRD_PARTY_NOTICES.md README.md ./

ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["--help"]
