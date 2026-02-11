# 🚀 Hướng Dẫn Deploy MDuc Flood API

## 1. Deploy lên Railway (Dễ nhất)
### Cách 1: Deploy từ GitHub
1. Push code lên GitHub
2. Vào Railway.app → New Project → Deploy from GitHub
3. Chọn repository
4. Chờ deploy xong

### Cách 2: Deploy từ CLI
```bash
# Cài Railway CLI
npm i -g @railway/cli

# Đăng nhập
railway login

# Tạo project
railway init

# Deploy
railway up
