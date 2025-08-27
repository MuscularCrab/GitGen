#!/bin/bash

echo "🧹 Cleaning up old dependencies..."
rm -rf node_modules
rm -rf client/node_modules
rm package-lock.json
rm client/package-lock.json

echo "📦 Installing updated server dependencies..."
npm install

echo "📦 Installing updated client dependencies..."
cd client && npm install && cd ..

echo "✅ Dependencies updated successfully!"
echo "🚀 You can now build your Docker container without deprecation warnings."
