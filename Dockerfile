# Rafiq Platform - Production Dockerfile
FROM node:20-alpine

# Install build tools
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies after build (but keep module-alias!)
RUN npm prune --production

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check - use /api/health since we have global prefix
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start with module-alias for path resolution
CMD ["node", "-r", "module-alias/register", "dist/main.js"]
