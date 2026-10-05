FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY app ./app
ENV PORT=8810
EXPOSE 8810
CMD ["node", "app/server.js"]
