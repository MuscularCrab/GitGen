#!/bin/bash

echo "🚀 Starting GitGen - Git Documentation Generator"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    npm install
fi

if [ ! -d "client/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd client && npm install && cd ..
fi

# Create necessary directories
mkdir -p temp uploads

echo ""
echo "🌐 Starting the application..."
echo "   Frontend will be available at: http://localhost:3000"
echo "   Backend API will be available at: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop the application"
echo ""

# Start the backend server
npm run dev