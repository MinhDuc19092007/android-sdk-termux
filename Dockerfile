# Dockerfile cho MDUC-FLOOD
FROM node:18-slim

# ======================
# System dependencies
# ======================
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates xvfb curl \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
    libnss3 libcups2 libxrandr2 libasound2 libpangocairo-1.0-0 \
    libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 \
    --no-install-recommends

# ======================
# Google Chrome
# ======================
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends

# Cleanup
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# ======================
# App directory
# ======================
WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài dependencies
RUN npm install \
    http https tls hpack.js net \
    express express-cluster cors dotenv \
    randomstring crypto puppeteer-real-browser

# ======================
# Copy source code
# ======================
COPY main.js ./

# Copy toàn bộ project (nếu có)
COPY . .

# ======================
# Đảm bảo file tồn tại
# ======================
RUN mkdir -p /app/data \
    && touch script.js proxy.js /app/data/apikey.json \
    && chown -R node:node /app

# ======================
# User
# ======================
USER node

# ======================
# Port & ENV
# ======================
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=":99"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/google-chrome
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV API_KEY_FILE=/app/data/apikey.json
ENV PROXY_FILE=/app/data/proxy.txt

# ======================
# Health check
# ======================
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# ======================
# Start
# ======================
CMD sh -c "Xvfb :99 -screen 0 1024x768x24 & node main.js"
