# Backend (Node API) - Dockerfile
# Small and secure base image
FROM node:18-alpine AS base

ENV NODE_ENV=production
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY api.js ./
# .env is injected at runtime via compose env_file, not baked into the image

# Health check is provided by compose using /health
EXPOSE 5174

# Use non-root user for security (node image already has user "node")
USER node

CMD ["node", "api.js"]
