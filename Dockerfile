# Use Node.js 20 Alpine as base image
FROM node:20-alpine

# Install git and other essential packages
RUN apk add --no-cache git python3 make g++

# Configure git for anonymous access
RUN git config --global user.name "GitGen Bot" && \
    git config --global user.email "bot@gitgen.com" && \
    git config --global init.defaultBranch main

# Set working directory
WORKDIR /app

# Copy package files first (for better layer caching)
COPY package*.json ./
COPY client/package*.json ./client/

# Set npm configuration for better performance and reliability
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fetch-timeout 600000 && \
    npm config set fetch-retry-mintimeout 30000 && \
    npm config set fetch-retry-maxtimeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set maxsockets 50 && \
    npm config set progress false

# Install server dependencies with better error handling
RUN npm install --production --no-audit --no-fund --timeout=600000 --verbose || \
    (echo "First attempt failed, retrying..." && npm install --production --no-audit --no-fund --timeout=600000)

# Install client dependencies with better error handling
RUN cd client && npm install --production --no-audit --no-fund --timeout=600000 --verbose || \
    (echo "First attempt failed, retrying..." && npm install --production --no-audit --no-fund --timeout=600000)

# Copy source code
COPY . .

# Build the React application
RUN npm run build:client

# Create necessary directories
RUN mkdir -p temp uploads

# Clean up npm cache to reduce image size
RUN npm cache clean --force && \
    cd client && npm cache clean --force

# Expose port
EXPOSE 3030

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3030/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]