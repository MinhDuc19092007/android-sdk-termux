FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# Cài đặt các thư viện hệ thống cần thiết cho Xvfb và Chrome
RUN apt-get update && apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2

COPY package.json .
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "main.js"]
