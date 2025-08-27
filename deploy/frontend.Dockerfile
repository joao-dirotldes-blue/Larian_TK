# Frontend (Nginx) - Dockerfile
FROM nginx:stable-alpine

# Copy static assets to Nginx web root
WORKDIR /usr/share/nginx/html
COPY index.html .
COPY styles.css .
COPY app.js .
COPY logo.png .
COPY ticket.html .

# Nginx config (proxy /api -> backend:5174 and SPA routing)
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
