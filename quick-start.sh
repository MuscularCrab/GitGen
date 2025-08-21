#!/bin/bash

# GitGen Quick Start Script
# This script helps you get GitGen running quickly

echo "🚀 GitGen Quick Start Script"
echo "=============================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://www.docker.com/products/docker-desktop/"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are available"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
PORT=3001
NODE_ENV=production
EOF
    echo "✅ Created .env file"
else
    echo "✅ .env file already exists"
fi

# Build and start the application
echo "🔨 Building GitGen..."
docker-compose build

if [ $? -eq 0 ]; then
    echo "✅ Build successful"
else
    echo "❌ Build failed"
    exit 1
fi

echo "🚀 Starting GitGen..."
docker-compose up -d

if [ $? -eq 0 ]; then
    echo "✅ GitGen started successfully!"
    echo ""
    echo "🌐 Access your application at:"
    echo "   http://localhost:3001"
    echo ""
    echo "📊 Check status with: docker-compose ps"
    echo "📝 View logs with: docker-compose logs -f"
    echo "🛑 Stop with: docker-compose down"
    echo ""
    echo "📚 For detailed instructions, see:"
    echo "   - WINDOWS_HOSTING.md (Windows users)"
    echo "   - DOCKER_HOSTING.md (Docker users)"
else
    echo "❌ Failed to start GitGen"
    echo "📝 Check logs with: docker-compose logs"
    exit 1
fi