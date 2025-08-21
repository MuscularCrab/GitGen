# GitGen Hosting Guide

This guide provides step-by-step instructions for hosting GitGen in both Docker and Windows environments.

## 🐳 Docker Hosting

### Prerequisites
- Docker installed on your system
- Docker Compose installed
- Git installed on the host system (for repository cloning)

### Quick Start with Docker

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd gitgen
   ```

2. **Build and start the application**
   ```bash
   # Build and start the production service
   docker-compose up -d
   
   # Or build and start with logs
   docker-compose up --build
   ```

3. **Access the application**
   - Frontend: http://localhost:3001
   - API: http://localhost:3001/api

4. **Stop the application**
   ```bash
   docker-compose down
   ```

### Development Mode with Docker

1. **Start development service**
   ```bash
   docker-compose --profile dev up gitgen-dev
   ```

2. **Access development environment**
   - Frontend: http://localhost:3002
   - API: http://localhost:3002/api

### Docker Production Deployment

1. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   NODE_ENV=production
   PORT=3001
   ```

2. **Build and deploy**
   ```bash
   # Build the production image
   docker build -t gitgen:latest .
   
   # Run the container
   docker run -d \
     --name gitgen \
     -p 3001:3001 \
     -v $(pwd)/temp:/app/temp \
     -v $(pwd)/uploads:/app/uploads \
     --restart unless-stopped \
     gitgen:latest
   ```

3. **Using Docker Compose for production**
   ```bash
   # Start production service
   docker-compose up -d gitgen
   
   # View logs
   docker-compose logs -f gitgen
   
   # Scale if needed
   docker-compose up -d --scale gitgen=3
   ```

### Docker Health Checks

The application includes built-in health checks:
```bash
# Check container health
docker ps

# View health check logs
docker-compose logs gitgen
```

## 🪟 Windows Hosting

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager
- Git for Windows installed
- Windows 10/11 or Windows Server 2019+

### Local Development Setup

1. **Install Node.js**
   - Download from [nodejs.org](https://nodejs.org/)
   - Choose LTS version (18.x or higher)
   - Verify installation: `node --version` and `npm --version`

2. **Clone and setup**
   ```cmd
   git clone <your-repo-url>
   cd gitgen
   npm run install:all
   ```

3. **Start development servers**
   ```cmd
   # Terminal 1 - Start backend
   npm run dev
   
   # Terminal 2 - Start frontend
   cd client
   npm start
   ```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:3001

### Windows Production Deployment

#### Option 1: Direct Node.js Deployment

1. **Build the application**
   ```cmd
   npm run build
   ```

2. **Start production server**
   ```cmd
   npm start
   ```

3. **Set up as Windows Service (Optional)**
   - Install PM2: `npm install -g pm2`
   - Create ecosystem file: `pm2 ecosystem`
   - Start with PM2: `pm2 start ecosystem.config.js`

#### Option 2: Windows Subsystem for Linux (WSL)

1. **Install WSL2**
   ```cmd
   wsl --install
   ```

2. **Follow Linux deployment steps**
   - Use the same commands as Docker deployment
   - Access via localhost:3001

#### Option 3: Windows Container

1. **Enable Windows Containers**
   - Install Docker Desktop for Windows
   - Switch to Windows containers mode

2. **Use the same Docker commands**
   ```cmd
   docker-compose up -d
   ```

### Windows-Specific Configuration

#### Environment Variables
Create a `.env` file:
```env
NODE_ENV=production
PORT=3001
TEMP_DIR=C:\gitgen\temp
UPLOADS_DIR=C:\gitgen\uploads
```

#### File Paths
- Use Windows-style paths: `C:\gitgen\temp`
- Ensure proper permissions on directories
- Consider using UNC paths for network storage

#### Firewall Configuration
1. **Allow Node.js through Windows Firewall**
   - Open Windows Defender Firewall
   - Add Node.js to allowed applications
   - Open port 3001 for inbound connections

2. **Network Configuration**
   ```cmd
   # Check if port is open
   netstat -an | findstr :3001
   
   # Test connectivity
   telnet localhost 3001
   ```

## 🔧 Common Issues and Solutions

### Docker Issues

1. **Port already in use**
   ```bash
   # Check what's using the port
   lsof -i :3001
   
   # Kill the process or change port in docker-compose.yml
   ```

2. **Permission denied for volumes**
   ```bash
   # Fix volume permissions
   sudo chown -R $USER:$USER ./temp ./uploads
   ```

3. **Container won't start**
   ```bash
   # Check logs
   docker-compose logs gitgen
   
   # Rebuild image
   docker-compose build --no-cache
   ```

### Windows Issues

1. **Node.js not found**
   - Restart command prompt after installation
   - Check PATH environment variable
   - Reinstall Node.js if needed

2. **Port access denied**
   - Run as Administrator
   - Check Windows Firewall settings
   - Verify no other service uses port 3001

3. **Git not found**
   - Install Git for Windows
   - Add Git to PATH environment variable
   - Restart command prompt

## 📊 Monitoring and Maintenance

### Docker Monitoring
```bash
# View resource usage
docker stats

# Check container logs
docker-compose logs -f gitgen

# Monitor disk usage
docker system df
```

### Windows Monitoring
```cmd
# Check process status
tasklist | findstr node

# Monitor resource usage
perfmon

# Check disk space
dir C:\
```

### Log Rotation
- Docker: Configure log drivers in docker-compose.yml
- Windows: Use PM2 log rotation or Windows Event Log

## 🚀 Performance Optimization

### Docker Optimization
1. **Use multi-stage builds**
2. **Optimize base images**
3. **Implement proper caching**
4. **Use volume mounts for persistent data**

### Windows Optimization
1. **Use PM2 for process management**
2. **Implement proper logging**
3. **Optimize Node.js settings**
4. **Use Windows Performance Monitor**

## 🔒 Security Considerations

### Docker Security
1. **Run containers as non-root user**
2. **Scan images for vulnerabilities**
3. **Use secrets management**
4. **Implement network policies**

### Windows Security
1. **Use Windows Defender**
2. **Implement proper user permissions**
3. **Regular security updates**
4. **Network isolation**

## 📞 Support

For issues and questions:
- Check the logs for error messages
- Review this hosting guide
- Check the main README.md
- Open an issue in the repository

## 🔄 Updates and Maintenance

### Docker Updates
```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Windows Updates
```cmd
# Pull latest changes
git pull origin main

# Install dependencies
npm run install:all

# Restart services
npm start
```