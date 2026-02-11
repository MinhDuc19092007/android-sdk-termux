#!/bin/bash
echo "╔══════════════════════════════════════════╗"
echo "║        MDUC FLOOD API - SETUP           ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "📦 Installing system dependencies..."

# Update và cài đặt dependencies
apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    xvfb \
    libxss1 \
    libappindicator1 \
    libindicator7 \
    fonts-liberation \
    libasound2 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libxrandr2 \
    libgbm1 \
    libxcb-dri3-0 \
    libdrm2 \
    libxkbcommon0 \
    libatk-bridge2.0-0 \
    libgtk-3-0

# Install Chrome
echo "🌐 Installing Google Chrome..."
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list
apt-get update
apt-get install -y google-chrome-stable

# Verify installation
echo "✅ Chrome version:"
google-chrome-stable --version

# Install Node dependencies
echo "📦 Installing Node.js dependencies..."
npm install puppeteer-real-browser

echo ""
echo "🎉 Setup completed! MDuc Flood API is ready."
echo "   Start with: npm start"
echo ""
