FROM node:22-alpine
WORKDIR /app
COPY . .
EXPOSE 4700
CMD ["node", "server.js"]
