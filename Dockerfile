FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY vendor ./vendor
COPY LICENSE THIRD_PARTY_NOTICES.md README.md ./

ENTRYPOINT ["node", "/app/src/cli.js"]
CMD ["--help"]
