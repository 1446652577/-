FROM node:20-slim

WORKDIR /app

COPY cloudfunctions/parseDocument/package*.json ./cloudfunctions/parseDocument/
RUN npm ci --omit=dev --no-audit --no-fund --prefix ./cloudfunctions/parseDocument

COPY cloudfunctions/parseDocument/index.js ./cloudfunctions/parseDocument/index.js
COPY cloudrun/parseDocument/server.js ./cloudrun/parseDocument/server.js

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "cloudrun/parseDocument/server.js"]
