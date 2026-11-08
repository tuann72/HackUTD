# T-Gate gateway (Twilio webhook + query API).
# Built and run by classifier/deploy/docker-compose.yml on the Vultr server, next to the classifier.
FROM node:24-slim

WORKDIR /app
COPY package.json package-lock.json ./
# `npm start` runs the TypeScript directly through tsx, which is a dev dependency.
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# SQLite lives on a named volume mounted here, so messages survive rebuilds.
RUN mkdir -p /app/data && chown node:node /app/data
ENV DB_PATH=/app/data/gateway.sqlite PORT=8787
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "--disable-warning=ExperimentalWarning", "src/server.ts"]
