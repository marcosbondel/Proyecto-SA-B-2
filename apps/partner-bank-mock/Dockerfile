FROM node:24.19.0-alpine
WORKDIR /app
COPY apps/partner-bank-mock/server.mjs ./server.mjs
USER node
EXPOSE 3021
CMD ["node", "server.mjs"]
