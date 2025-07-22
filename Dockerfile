# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --production && npm cache clean --force

# Copy application files
COPY server.js ./

# Create required directories
RUN mkdir -p content themes ssl

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mdcms -u 1001 -G nodejs

# Change ownership of app directory
RUN chown -R mdcms:nodejs /app

# Switch to non-root user
USER mdcms

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]