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

# Set up a cron job to run the sync script daily
RUN apk add --no-cache bash curl tzdata && \
    echo "0 0 * * * node /usr/src/app/sync.js >> /var/log/cron.log 2>&1" > /etc/crontabs/root && \
    touch /var/log/cron.log

# Default port (can be overridden by environment variable)
ENV PORT=3000

# Expose the port configured by the PORT environment variable
EXPOSE ${PORT}

# Command to start cron and a basic HTTP server to keep the container running
CMD ["sh", "-c", "crond && node -e \"require('http').createServer((_, res) => res.end('Running')).listen(process.env.PORT)\" && tail -f /var/log/cron.log"]
