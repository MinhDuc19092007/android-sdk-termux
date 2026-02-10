const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");

const CONFIG = {
  sources: [
    "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all",
    "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",

  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all",
  "https://www.proxy-list.download/api/v1/get?type=http",
  "https://www.proxy-list.download/api/v1/get?type=https",
  "https://proxyspace.pro/http.txt",
  "https://proxyspace.pro/https.txt",

  // GitHub raw lists (HTTP / HTTPS)
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",
  "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt",
  "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/https.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/https.txt",
  "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt",
  "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/https.txt",

  // Other raw sources
  "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/https.txt",
  "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/https.txt",
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all",
  "https://www.proxy-list.download/api/v1/get?type=http",
  "https://www.proxy-list.download/api/v1/get?type=https",
  "https://proxyspace.pro/http.txt",
  "https://proxyspace.pro/https.txt",

  // GitHub raw lists (HTTP / HTTPS)
  "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",
  "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt",
  "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/https.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/prxchk/proxy-list/main/https.txt",
  "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt",
  "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/HyperBeats/proxy-list/main/https.txt",

  // Other raw sources
  "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/https.txt",
  "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/https.txt",
  ],
  timeout: 8000,
  concurrency: 500,
  outputFile: "proxy.txt",
};

let isSilent = process.argv.includes("--silent");
const log = (...args) => {
  if (!isSilent) console.log(...args);
};

let checked = 0,
  working = 0,
  total = 0;

async function fetchUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
  });
}

async function downloadProxies() {
  console.log("📥 Downloading proxies...\n");
  const allProxies = new Set();
  const promises = CONFIG.sources.map(async (source) => {
    try {
      const data = await fetchUrl(source);
      const proxies = data
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l));
      proxies.forEach((p) => allProxies.add(p));
      log(`  ✅ ${proxies.length} from ${source.slice(8, 45)}...`);
    } catch {}
  });
  await Promise.all(promises);
  log(`\n📊 Total: ${allProxies.size} unique proxies\n`);
  return [...allProxies];
}

function checkProxy(proxy) {
  return new Promise((resolve) => {
    const [host, port] = proxy.split(":");

    const options = {
      host: host,
      port: parseInt(port),
      method: "GET",
      path: "http://www.google.com/",
      headers: {
        Host: "www.google.com",
        "User-Agent": "Mozilla/5.0",
        Connection: "close",
      },
      timeout: CONFIG.timeout,
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const isWorking =
          res.statusCode >= 200 &&
          res.statusCode < 400 &&
          body.includes("google");
        resolve(isWorking);
      });
    });

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    setTimeout(() => {
      req.destroy();
      resolve(false);
    }, CONFIG.timeout);
    req.end();
  });
}

function saveProxy(proxy) {
  fs.appendFileSync(CONFIG.outputFile, proxy + "\n");
}

async function worker(proxies) {
  for (const proxy of proxies) {
    try {
      const isWorking = await checkProxy(proxy);
      checked++;
      if (isWorking) {
        working++;
        saveProxy(proxy);
      }
      if (!isSilent) {
        process.stdout.write(
          `\r🔍 ${checked}/${total} | ✅ Live: ${working}        `,
        );
      }
    } catch {}
  }
}

async function runScraper() {
  log(`
╔══════════════════════════════════════════════════╗
║        🔥 LEAK PROXY SCRAPER & CHECKER 🔥        ║
║         Test with real Google request            ║
╚══════════════════════════════════════════════════╝
`);

  if (fs.existsSync(CONFIG.outputFile)) fs.unlinkSync(CONFIG.outputFile);

  const proxies = await downloadProxies();
  total = proxies.length;

  if (total === 0) {
    log("❌ No proxies!");
    return;
  }

  log(`🚀 Checking with ${CONFIG.concurrency} concurrent (Google test)...\n`);

  const batchSize = Math.ceil(total / CONFIG.concurrency);
  const batches = [];
  for (let i = 0; i < CONFIG.concurrency; i++) {
    const batch = proxies.slice(i * batchSize, (i + 1) * batchSize);
    if (batch.length) batches.push(worker(batch));
  }

  await Promise.all(batches);

  log(`\n\n════════════════════════════════════════`);
  log(`  Checked: ${checked} | Working: ${working}`);
  log(`  Saved to: ${CONFIG.outputFile}`);
  log(`════════════════════════════════════════`);
}

if (require.main === module) {
  runScraper().catch(() => {});
}

module.exports = { runScraper };
