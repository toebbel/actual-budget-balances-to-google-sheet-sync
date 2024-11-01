# Use the official Node.js image as the base image
FROM node:lts-bullseye-slim

# Set NODE_ENV to production for optimized dependency installation
ENV NODE_ENV=production

# Install Python and essential build tools in a single RUN command to reduce image layers
RUN apt-get update --no-cache && apt-get install -y \
    python3 \
    build-essential \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /usr/src/app

# Copy only package.json and yarn.lock for optimized caching
COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --production

# Copy the rest of the application code
COPY . .

# Run the full-sync script by default
CMD ["yarn", "run", "full-sync"]
