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

# Expose a port if necessary (not needed for this script)
# EXPOSE 8080

# Command to start cron and tail logs
CMD ["sh", "-c", "crond && tail -f /var/log/cron.log"]
