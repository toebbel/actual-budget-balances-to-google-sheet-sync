# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Install bash, curl, and timezone data
RUN apk add --no-cache bash curl tzdata

# Set up a cron job to run the sync script daily
RUN echo "0 0 * * * node /usr/src/app/sync.js >> /var/log/cron.log 2>&1" > /etc/crontabs/root && \
    touch /var/log/cron.log

# Default port (can be overridden by environment variable)
ENV SYNC_PORT=3000

# Health check to ensure the server is running
HEALTHCHECK --interval=1m --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:$SYNC_PORT/ || exit 1

# Command to start cron and a basic HTTP server to keep the container running
CMD ["sh", "-c", "crond && node -e \"require('http').createServer((_, res) => res.end('Running')).listen(process.env.SYNC_PORT)\" && tail -f /var/log/cron.log"]
