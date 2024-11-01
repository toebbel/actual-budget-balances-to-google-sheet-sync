# Use the official Node.js image as the base image
FROM node:lts-bullseye-slim

RUN apt-get update || : && apt-get install -y \
    python3 \
    build-essential

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install

# Copy the rest of the application code
COPY . .

# Set the entrypoint to run the full-sync script
ENTRYPOINT ["yarn", "run", "full-sync"]