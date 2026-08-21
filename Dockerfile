FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public
COPY shared ./shared

ENV PORT=8080
EXPOSE 8080

CMD ["npm", "start"]
