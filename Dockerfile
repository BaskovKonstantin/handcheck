FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY app ./app
COPY scripts ./scripts
ENV PORT=8810
EXPOSE 8810
CMD ["node", "app/server.js"]
