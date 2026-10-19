FROM node:24.19.0-alpine
WORKDIR /app
# Sin dependencias en tiempo de ejecucion: el punto de entrada, los modulos de
# `src/` y los esquemas del contrato generados (`src/contract-schemas.json`).
COPY apps/partner-bank-mock/server.mjs ./server.mjs
COPY apps/partner-bank-mock/src ./src
USER node
EXPOSE 3021
CMD ["node", "server.mjs"]
