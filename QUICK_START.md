# GitGen Quick Start Guide

## 🐳 Docker (Recommended)

### Prerequisites
- Docker and Docker Compose installed
- Git installed on host system

### Quick Start
```bash
# 1. Clone and enter directory
git clone <your-repo-url>
cd gitgen

# 2. Start the application
docker-compose up -d

# 3. Access the app
# Frontend: http://localhost:3001
# API: http://localhost:3001/api

# 4. Stop when done
docker-compose down
```

### Development Mode
```bash
# Start development service
docker-compose --profile dev up gitgen-dev

# Access at http://localhost:3002
```

## 🪟 Windows

### Prerequisites
- Node.js 18+ installed
- Git for Windows installed

### Quick Start
```cmd
# 1. Clone and enter directory
git clone <your-repo-url>
cd gitgen

# 2. Install dependencies
npm run install:all

# 3. Start development servers
# Terminal 1: npm run dev
# Terminal 2: cd client && npm start

# 4. Access the app
# Frontend: http://localhost:3000
# Backend: http://localhost:3001
```

### Production Build
```cmd
# Build the app
npm run build

# Start production server
npm start

# Access at http://localhost:3001
```

## 📋 What's Next?

- **Full Documentation**: See [HOSTING.md](HOSTING.md) for detailed instructions
- **Configuration**: Check [README.md](README.md) for advanced setup
- **Issues**: Open an issue if you encounter problems

## 🚀 Features

- Generate documentation from any Git repository
- Support for 13+ programming languages
- Beautiful, responsive web interface
- Real-time processing and status updates
- Export and share capabilities

---

**GitGen** - Making documentation generation effortless and beautiful! 🚀