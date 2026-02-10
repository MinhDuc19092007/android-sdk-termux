# Dockerfile cho MDUC-FLOOD
FROM node:18-slim

# Cài system dependencies
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates xvfb \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 \
    libnss3 libcups2 libxrandr2 libasound2 libpangocairo-1.0-0 \
    libatk1.0-0 libatk-bridge2.0-0 libgtk-3-0 --no-install-recommends

# Cài Google Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends

# Clean up
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Tạo thư mục app
WORKDIR /app

# Copy package files
COPY package*.json ./

# Cài tất cả dependencies trong 1 lệnh
RUN npm install http https tls hpack.js net express-cluster randomstring crypto puppeteer-real-browser express cors dotenv

# Copy tất cả source files
COPY main.js ./
COPY script.js ./ 2>/dev/null || echo "script.js not found, will be created if needed"
COPY proxy.js ./ 2>/dev/null || echo "proxy.js not found, will be created if needed"

# Copy apikey.json nếu có (tùy chọn)
COPY apikey.json /app/data/apikey.json 2>/dev/null || echo "Will create default API keys"

# Tạo thư mục data
RUN mkdir -p /app/data && chown -R node:node /app

# Switch user
USER node

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=":99"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
ENV CHROME_PATH="/usr/bin/google-chrome"
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/google-chrome"
ENV API_KEY_FILE="/app/data/apikey.json"
ENV PROXY_FILE="/app/data/proxy.txt"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start command
CMD sh -c 'Xvfb :99 -screen 0 1024x768x24 & node main.js'
