const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

// ── CONFIG ────────────────────────────────────────────────────────────────────
const FRESHDESK_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;
// ─────────────────────────────────────────────────────────────────────────────

const AUTH = "Basic " + Buffer.from(API_KEY + ":X").toString("base64");

function freshdeskRequest(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: FRESHDESK_DOMAIN,
      path: "/api/v2" + apiPath,
      method: "GET",
      headers: {
        Authorization: AUTH,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve the dashboard HTML
  if (parsed.pathname === "/" || parsed.pathname === "/index.html") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Proxy API calls
  if (parsed.pathname.startsWith("/api/")) {
    const apiPath = parsed.pathname.replace("/api", "") + (parsed.search || "");
    try {
      const result = await freshdeskRequest(apiPath);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n✅  Freshdesk Dashboard running at http://localhost:${PORT}\n`);
  console.log(`   Domain : ${FRESHDESK_DOMAIN}`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
