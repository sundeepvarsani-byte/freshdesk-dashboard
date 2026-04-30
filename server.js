const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

// ── CONFIG ────────────────────────────────────────────────────────────────────
const FRESHSERVICE_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;
// ─────────────────────────────────────────────────────────────────────────────

const AUTH = "Basic " + Buffer.from(API_KEY + ":X").toString("base64");

function freshserviceRequest(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: FRESHSERVICE_DOMAIN,
      path: "/api/v2" + apiPath,
      method: "GET",
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (parsed.pathname === "/" || parsed.pathname === "/index.html") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Debug endpoints to inspect raw API structure
  if (parsed.pathname === "/debug/agents") {
    const result = await freshserviceRequest("/agents?per_page=3");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }
  if (parsed.pathname === "/debug/tickets") {
    const result = await freshserviceRequest("/tickets?per_page=3");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }
  if (parsed.pathname === "/debug/groups") {
    const result = await freshserviceRequest("/groups?per_page=20");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }

  if (parsed.pathname.startsWith("/api/")) {
    const apiPath = parsed.pathname.replace("/api", "") + (parsed.search || "");
    try {
      const result = await freshserviceRequest(apiPath);
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
  console.log(`\n✅  Freshservice Dashboard running at http://localhost:${PORT}`);
  console.log(`   Debug agents : http://localhost:${PORT}/debug/agents`);
  console.log(`   Debug tickets: http://localhost:${PORT}/debug/tickets`);
  console.log(`   Debug groups : http://localhost:${PORT}/debug/groups\n`);
});
