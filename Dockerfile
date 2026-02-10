# Dockerfile
# ========== PHASE 1: BASE IMAGE ==========
FROM node:18-slim

# ========== PHASE 2: INSTALL SYSTEM DEPENDENCIES ==========
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    xvfb \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    --no-install-recommends

# ========== PHASE 3: INSTALL GOOGLE CHROME ==========
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends

# ========== PHASE 4: CLEAN UP ==========
RUN apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ========== PHASE 5: CREATE APP DIRECTORY ==========
WORKDIR /app

# ========== PHASE 6: COPY PACKAGE FILES ==========
COPY package*.json ./

# ========== PHASE 7: INSTALL ALL NODE DEPENDENCIES IN ONE COMMAND ==========
RUN npm install \
    http \
    https \
    tls \
    hpack.js \
    net \
    express-cluster \
    randomstring \
    crypto \
    puppeteer-real-browser \
    express \
    cors \
    dotenv \
    helmet \
    morgan \
    express-rate-limit

# ========== PHASE 8: COPY SOURCE CODE ==========
COPY . .

# ========== PHASE 9: CREATE DATA DIRECTORY ==========
RUN mkdir -p /app/data \
    && chown -R node:node /app

# ========== PHASE 10: SWITCH TO NODE USER ==========
USER node

# ========== PHASE 11: EXPOSE PORT ==========
EXPOSE 3000

# ========== PHASE 12: SET ENVIRONMENT VARIABLES ==========
ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=":99"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROME_PATH="/usr/bin/google-chrome"
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome"
ENV API_KEY_FILE="/app/data/apikey.json"
ENV PROXY_FILE="/app/data/proxy.txt"

# ========== PHASE 13: HEALTH CHECK ==========
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# ========== PHASE 14: START COMMAND ==========
CMD sh -c 'Xvfb :99 -screen 0 1024x768x24 & node main.js'
