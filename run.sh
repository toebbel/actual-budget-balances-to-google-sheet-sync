#!/bin/bash

# Define environment variables
IMAGE_NAME="${IMAGE_NAME:-my-app}"
ENV_FILE="${ENV_FILE:-.env}"
CONTAINER_NAME="${CONTAINER_NAME:-my-app-container}"

# Build the Docker image
echo "Building Docker image '$IMAGE_NAME'..."
docker build -t "$IMAGE_NAME" .

# Check if the build was successful
if [ $? -ne 0 ]; then
  echo "Error: Docker build failed. Please check the Dockerfile and try again."
  exit 1
fi

# Run the Docker container with the .env file and optional port mapping
echo "Running Docker container '$CONTAINER_NAME'..."
docker run --rm --env-file "$ENV_FILE" --name "$CONTAINER_NAME" "$IMAGE_NAME"

# Check if the container ran successfully
if [ $? -ne 0 ]; then
  echo "Error: Docker container failed to run. Please check your .env file and Docker configurations."
  exit 1
fi

echo "Docker container '$CONTAINER_NAME' ran successfully."
