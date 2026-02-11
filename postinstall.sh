#!/bin/bash
echo "🔧 Running post-installation setup..."

# Kiểm tra Chrome
if ! command -v google-chrome-stable &> /dev/null; then
    echo "⚠️ Chrome not found, running full setup..."
    chmod +x setup.sh
    ./setup.sh
fi

# Tạo file cấu hình nếu chưa có
if [ ! -f "apikey.json" ]; then
    echo "📄 Creating apikey.json..."
    node -e "
        const crypto = require('crypto');
        const fs = require('fs');
        const data = {
            owner_key: crypto.randomBytes(32).toString('hex'),
            api_keys: {},
            settings: {
                app_name: 'MDuc Flood API',
                version: '2.0.0',
                default_max_time: 300,
                default_max_threads: 20,
                default_max_rate: 100,
                default_max_concurrent: 3,
                default_max_browsers: 5,
                default_daily_limit: 10,
                proxy_file: 'proxy.txt',
                allowed_browser_options: ['--browser', '--randpath', '--reset', '--debug', '--close']
            }
        };
        fs.writeFileSync('apikey.json', JSON.stringify(data, null, 2));
        console.log('🔑 Owner Key:', data.owner_key.substring(0, 8) + '...');
        console.log('💾 Save this key for owner access!');
    "
fi

# Tạo file proxy.txt nếu chưa có
if [ ! -f "proxy.txt" ]; then
    echo "📄 Creating empty proxy.txt..."
    echo "# Add your proxies here" > proxy.txt
    echo "# Format: http://user:pass@ip:port" >> proxy.txt
fi

echo "✅ Post-installation completed!"
