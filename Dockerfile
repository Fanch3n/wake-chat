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

# Start node directly: configuration comes from environment variables
# (docker-compose env_file), not from a .env file inside the image.
# Running node as PID 1 also lets it receive SIGTERM on docker stop.
CMD ["node", "src/server.js"]
