const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const FRESHSERVICE_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;

const AUTH = "Basic " + Buffer.from(API_KEY + ":X").toString("base64");

function fsRequest(apiPath) {
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

async function getAllGroups() {
  let all = [];
  for (let page = 1; page <= 5; page++) {
    const result = await fsRequest(`/groups?per_page=100&page=${page}`);
    const body = result.body;
    const batch = body.groups || (Array.isArray(body) ? body : []);
    if (!batch.length) break;
    all = all.concat(batch);
    if (batch.length < 100) break;
  }
  return all;
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

  // Debug: clean list of ALL groups — id and name only
  if (parsed.pathname === "/debug/groups") {
    const groups = await getAllGroups();
    const summary = groups.map(g => ({ id: g.id, name: g.name }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total: summary.length, groups: summary }, null, 2));
    return;
  }

  if (parsed.pathname === "/debug/agents") {
    const result = await fsRequest("/agents?per_page=3&active=true");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }

  if (parsed.pathname === "/debug/tickets") {
    const result = await fsRequest("/tickets?per_page=3");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }


  // Debug: list all workspaces
  if (parsed.pathname === "/debug/workspaces") {
    const result = await fsRequest("/workspaces?per_page=50");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body, null, 2));
    return;
  }

  // Debug: groups across all workspaces
  if (parsed.pathname === "/debug/allgroups") {
    const wsResult = await fsRequest("/workspaces?per_page=50");
    const wsBody = wsResult.body;
    const workspaces = wsBody.workspaces || (Array.isArray(wsBody) ? wsBody : []);
    const allData = [];
    for (const ws of workspaces) {
      const grResult = await fsRequest(`/groups?per_page=100&workspace_id=${ws.id}`);
      const grBody = grResult.body;
      const groups = grBody.groups || (Array.isArray(grBody) ? grBody : []);
      allData.push({ workspace_id: ws.id, workspace_name: ws.name, groups: groups.map(g => ({ id: g.id, name: g.name })) });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(allData, null, 2));
    return;
  }

  if (parsed.pathname.startsWith("/api/")) {
    const apiPath = parsed.pathname.replace("/api", "") + (parsed.search || "");
    const finalPath = apiPath.startsWith("/agents") && !apiPath.includes("active=")
      ? apiPath + (apiPath.includes("?") ? "&active=true" : "?active=true")
      : apiPath;
    try {
      const result = await fsRequest(finalPath);
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
  console.log(`\n✅  Freshservice Dashboard: http://localhost:${PORT}`);
  console.log(`   Groups debug : http://localhost:${PORT}/debug/groups\n`);
});
