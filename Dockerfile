# Use a lightweight Node.js image
FROM node:24-alpine

ENV NODE_ENV=production

# Set working directory inside the container
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install only production dependencies
# (using ci ensures strict locking to package-lock.json)
RUN npm ci --omit=dev

# Copy the rest of your application code (see .dockerignore)
COPY . .

# Run as the unprivileged user provided by the Node image
USER node

# Expose the port your server runs on (default 3000)
EXPOSE 3000

# Let Docker report the container as unhealthy when the server stops responding
# (busybox wget ships with the Alpine image)
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Start node directly: configuration comes from environment variables
# (docker-compose env_file), not from a .env file inside the image.
# Node runs as PID 1 and receives SIGTERM on docker stop directly;
# src/server.js handles it and shuts down cleanly.
CMD ["node", "src/server.js"]
