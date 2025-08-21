# GitGen - Docker Hosting Guide

This guide provides comprehensive instructions for hosting GitGen using Docker containers on any operating system.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Docker Desktop** - Download from [docker.com](https://www.docker.com/products/docker-desktop/)
- **Docker Compose** (usually included with Docker Desktop)
- **Git** - For cloning the repository

## Quick Start (Recommended)

### 1. Clone and Run

```bash
# Clone the repository
git clone <your-repo-url>
cd gitgen

# Start the application
docker-compose up -d

# Check status
docker-compose ps
```

The application will be available at **http://localhost:3001**

### 2. Stop the Application

```bash
docker-compose down
```

## Detailed Setup Guide

### Step 1: Clone the Repository

```bash
git clone <your-repo-url>
cd gitgen
```

### Step 2: Environment Configuration

1. Create a `.env` file in the root directory:
   ```bash
   # Create .env file
   cat > .env << EOF
   PORT=3001
   NODE_ENV=production
   EOF
   ```

2. Or manually create `.env` with these contents:
   ```env
   PORT=3001
   NODE_ENV=production
   ```

### Step 3: Build and Start

```bash
# Build the images
docker-compose build

# Start the services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Step 4: Verify Deployment

1. Check service status:
   ```bash
   docker-compose ps
   ```

2. Test the application:
   ```bash
   curl http://localhost:3001/api/health
   ```

3. Open your browser and navigate to **http://localhost:3001**

## Docker Configuration Details

### Dockerfile Analysis

The GitGen Dockerfile is optimized for production:

```dockerfile
# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Install git (required for repository cloning)
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install

# Copy source code
COPY . .

# Build the React application
RUN npm run build:client

# Create necessary directories
RUN mkdir -p temp uploads

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["npm", "start"]
```

### Docker Compose Services

The `docker-compose.yml` defines two services:

#### Production Service (`gitgen`)
- **Port**: 3001:3001
- **Environment**: Production mode
- **Volumes**: Persistent storage for temp files and uploads
- **Health Check**: Automatic health monitoring
- **Restart Policy**: Automatic restart unless manually stopped

#### Development Service (`gitgen-dev`)
- **Port**: 3002:3001
- **Environment**: Development mode
- **Volumes**: Live code reloading
- **Command**: Development server with hot reload

## Advanced Configuration

### Custom Port Configuration

To change the default port, modify `docker-compose.yml`:

```yaml
services:
  gitgen:
    ports:
      - "8080:3001"  # Change 8080 to your desired port
```

### Environment Variables

Add custom environment variables:

```yaml
services:
  gitgen:
    environment:
      - NODE_ENV=production
      - PORT=3001
      - CUSTOM_VAR=value
```

### Volume Mounts

Customize volume mounts for data persistence:

```yaml
services:
  gitgen:
    volumes:
      - ./data:/app/data          # Custom data directory
      - ./logs:/app/logs          # Log files
      - ./uploads:/app/uploads    # File uploads
      - ./temp:/app/temp          # Temporary files
```

### Resource Limits

Add resource constraints:

```yaml
services:
  gitgen:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'
```

## Production Deployment

### 1. Production Environment Variables

Create `.env.production`:

```env
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
ENABLE_HTTPS=true
SSL_CERT_PATH=/etc/ssl/certs
SSL_KEY_PATH=/etc/ssl/private
```

### 2. Production Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  gitgen:
    build: .
    ports:
      - "80:3001"
      - "443:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./uploads:/app/uploads
      - ./temp:/app/temp
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
        reservations:
          memory: 1G
          cpus: '0.5'
```

### 3. Start Production Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Docker Commands Reference

### Basic Commands

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Scale services
docker-compose up -d --scale gitgen=3
```

### Container Management

```bash
# List running containers
docker ps

# Execute commands in container
docker exec -it gitgen_gitgen_1 sh

# View container logs
docker logs gitgen_gitgen_1

# Stop specific container
docker stop gitgen_gitgen_1

# Remove containers
docker-compose down --rmi all
```

### Image Management

```bash
# List images
docker images

# Remove unused images
docker image prune

# Remove all images
docker image prune -a

# Build without cache
docker-compose build --no-cache
```

## Monitoring and Logging

### Health Checks

The application includes built-in health checks:

```bash
# Check health status
curl http://localhost:3001/api/health

# View health check logs
docker-compose logs gitgen | grep health
```

### Log Management

```bash
# View real-time logs
docker-compose logs -f gitgen

# View logs with timestamps
docker-compose logs -f -t gitgen

# Export logs to file
docker-compose logs gitgen > gitgen.log
```

### Performance Monitoring

```bash
# Container resource usage
docker stats

# Container inspection
docker inspect gitgen_gitgen_1

# Process list in container
docker exec gitgen_gitgen_1 ps aux
```

## Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Find process using port
sudo lsof -i :3001

# Kill process
sudo kill -9 <PID>

# Or use different port in docker-compose.yml
```

#### Container Won't Start
```bash
# Check logs
docker-compose logs gitgen

# Check container status
docker-compose ps

# Restart with fresh build
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

#### Build Failures
```bash
# Clear Docker cache
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache

# Check Dockerfile syntax
docker build -t test .
```

#### Memory Issues
```bash
# Check container memory usage
docker stats

# Increase memory limits in docker-compose.yml
# Add swap space to host system
```

### Debug Mode

Enable debug logging:

```yaml
services:
  gitgen:
    environment:
      - DEBUG=*
      - NODE_ENV=development
```

## Security Best Practices

### 1. Non-Root User

Modify Dockerfile to run as non-root:

```dockerfile
# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs
```

### 2. Security Scanning

```bash
# Scan images for vulnerabilities
docker scan gitgen:latest

# Use security-focused base images
FROM node:18-alpine-slim
```

### 3. Network Security

```yaml
services:
  gitgen:
    networks:
      - internal
    expose:
      - "3001"

networks:
  internal:
    driver: bridge
    internal: true
```

## Backup and Recovery

### Data Backup

```bash
# Backup volumes
docker run --rm -v gitgen_data:/data -v $(pwd):/backup alpine tar czf /backup/gitgen_backup.tar.gz -C /data .

# Restore volumes
docker run --rm -v gitgen_data:/data -v $(pwd):/backup alpine tar xzf /backup/gitgen_backup.tar.gz -C /data
```

### Configuration Backup

```bash
# Backup docker-compose files
cp docker-compose.yml docker-compose.yml.backup
cp .env .env.backup

# Backup custom configurations
tar czf config_backup.tar.gz docker-compose*.yml .env*
```

## Scaling and Load Balancing

### Horizontal Scaling

```bash
# Scale to multiple instances
docker-compose up -d --scale gitgen=3

# Use load balancer (nginx example)
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - gitgen
```

### Load Balancer Configuration

Create `nginx.conf`:

```nginx
upstream gitgen {
    server gitgen:3001;
}

server {
    listen 80;
    location / {
        proxy_pass http://gitgen;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Maintenance

### Regular Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Clean up old images
docker image prune -f
```

### System Maintenance

```bash
# Update Docker
docker system update

# Clean up system
docker system prune -a

# Check disk usage
docker system df
```

## Support and Resources

### Documentation
- [Docker Official Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/)

### Community
- [Docker Community Forums](https://forums.docker.com/)
- [Stack Overflow - Docker](https://stackoverflow.com/questions/tagged/docker)

### Troubleshooting
- Check application logs: `docker-compose logs -f`
- Verify container status: `docker-compose ps`
- Test connectivity: `curl http://localhost:3001/api/health`

---

**GitGen** - Making documentation generation effortless and beautiful with Docker! 🐳🚀