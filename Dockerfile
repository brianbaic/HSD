FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY client ./client
COPY vite.config.mjs ./
RUN npm ci
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN apk add --no-cache bash lm_sensors php84 php84-phar php84-session smartmontools util-linux
RUN ln -sf /usr/bin/php84 /usr/bin/php
RUN npm ci --omit=dev

COPY server.js ./
COPY data ./data
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3019

EXPOSE 3019

CMD ["npm", "start"]
