#!/bin/bash

# Define the Docker image name
IMAGE_NAME="my-app"

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_NAME .

# Check if the build was successful
if [ $? -ne 0 ]; then
  echo "Docker build failed. Exiting."
  exit 1
fi

# Run the Docker container with the .env file
echo "Running Docker container..."
docker run --env-file .env $IMAGE_NAME

# Check if the container ran successfully
if [ $? -ne 0 ]; then
  echo "Docker run failed. Exiting."
  exit 1
fi

echo "Docker container ran successfully."