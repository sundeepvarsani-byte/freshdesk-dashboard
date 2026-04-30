const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const FRESHSERVICE_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;
const WORKSPACE_IDS = [2, 3, 4]; // IT, HHS Facilities, TGS Facilities

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

// Fetch all tickets for a specific workspace
async function getTicketsForWorkspace(workspaceId) {
  let all = [];
  for (let page = 1; page <= 5; page++) {
    const result = await fsRequest(`/tickets?per_page=100&page=${page}&order_by=created_at&order_type=desc&workspace_id=${workspaceId}`);
    const body = result.body;
    const batch = body.tickets || (Array.isArray(body) ? body : []);
    if (!batch.length) break;
    // Tag each ticket with workspace_id in case API doesn't return it
    batch.forEach(t => { if (!t.workspace_id) t.workspace_id = workspaceId; });
    all = all.concat(batch);
    if (batch.length < 100) break;
  }
  return all;
}

// Fetch agents for a specific workspace
async function getAgentsForWorkspace(workspaceId) {
  const result = await fsRequest(`/agents?per_page=100&active=true&workspace_id=${workspaceId}`);
  const body = result.body;
  return body.agents || (Array.isArray(body) ? body : []);
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

  // Main data endpoint — fetches tickets from all workspaces in parallel
  if (parsed.pathname === "/api/alltickets") {
    try {
      const results = await Promise.all(WORKSPACE_IDS.map(id => getTicketsForWorkspace(id)));
      const allTickets = results.flat();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tickets: allTickets, total: allTickets.length }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Agents endpoint — fetches active agents from all workspaces, deduped by id
  if (parsed.pathname === "/api/allagents") {
    try {
      const results = await Promise.all(WORKSPACE_IDS.map(id => getAgentsForWorkspace(id)));
      const seen = new Set();
      const allAgents = results.flat().filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agents: allAgents }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Debug endpoints
  if (parsed.pathname === "/debug/sample") {
    try {
      const it   = await getTicketsForWorkspace(2);
      const hhs  = await getTicketsForWorkspace(3);
      const tgs  = await getTicketsForWorkspace(4);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        IT_count: it.length,   IT_sample_workspace_id: it[0]?.workspace_id,
        HHS_count: hhs.length, HHS_sample_workspace_id: hhs[0]?.workspace_id,
        TGS_count: tgs.length, TGS_sample_workspace_id: tgs[0]?.workspace_id,
      }, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Fallback proxy for any other /api/ calls
  if (parsed.pathname.startsWith("/api/")) {
    const apiPath = parsed.pathname.replace("/api", "") + (parsed.search || "");
    try {
      const result = await fsRequest(apiPath);
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
  console.log(`   Debug sample : http://localhost:${PORT}/debug/sample\n`);
});
