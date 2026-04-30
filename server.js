const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const FRESHSERVICE_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;
const WORKSPACE_IDS = [2, 3, 4]; // IT=2, HHS=3, TGS=4

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

async function getTicketsForWorkspace(workspaceId) {
  // Fetch two sets in parallel:
  // 1. Recent tickets (last 90 days) for charts/trends - up to 1500
  // 2. ALL currently active tickets (open, on hold, 3rd party) regardless of age
  const ACTIVE_STATUSES = [2, 3, 6, 7]; // Open, Pending, On Hold, 3rd Party

  // Fetch recent tickets for history/charts
  let recent = [];
  for (let page = 1; page <= 15; page++) {
    const result = await fsRequest(`/tickets?per_page=100&page=${page}&order_by=created_at&order_type=desc&workspace_id=${workspaceId}`);
    const body = result.body;
    const batch = body.tickets || (Array.isArray(body) ? body : []);
    if (!batch.length) break;
    batch.forEach(t => { if (!t.workspace_id) t.workspace_id = workspaceId; });
    recent = recent.concat(batch);
    if (batch.length < 100) break;
  }

  // Fetch ALL active tickets for each active status separately
  let activeTickets = [];
  for (const status of ACTIVE_STATUSES) {
    for (let page = 1; page <= 10; page++) {
      const result = await fsRequest(`/tickets?per_page=100&page=${page}&status=${status}&workspace_id=${workspaceId}`);
      const body = result.body;
      const batch = body.tickets || (Array.isArray(body) ? body : []);
      if (!batch.length) break;
      batch.forEach(t => { if (!t.workspace_id) t.workspace_id = workspaceId; });
      activeTickets = activeTickets.concat(batch);
      if (batch.length < 100) break;
    }
  }

  // Merge — deduplicate by ticket id, active tickets take priority
  const seen = new Set();
  const merged = [];
  for (const t of [...activeTickets, ...recent]) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      merged.push(t);
    }
  }
  return merged;
}

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

  // All tickets across all workspaces
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

  // All active agents deduped
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

  // Debug: workspace ticket counts
  if (parsed.pathname === "/debug/sample") {
    try {
      const [it, hhs, tgs] = await Promise.all([
        getTicketsForWorkspace(2),
        getTicketsForWorkspace(3),
        getTicketsForWorkspace(4),
      ]);
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

  // Debug: show all fields on a single IT ticket so we can see time fields
  if (parsed.pathname === "/debug/ticketfields") {
    try {
      const result = await fsRequest("/tickets?per_page=3&workspace_id=2&order_by=updated_at&order_type=desc");
      const body = result.body;
      const tickets = body.tickets || (Array.isArray(body) ? body : []);
      // Return just the first ticket with all its fields
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tickets[0] || {}, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Debug: fetch ticket_fields to get custom status names
  if (parsed.pathname === "/debug/statusnames") {
    try {
      const result = await fsRequest("/ticket_fields?workspace_id=2");
      const body = result.body;
      const fields = body.ticket_fields || (Array.isArray(body) ? body : []);
      const statusField = fields.find(f => f.name === "status" || f.field_type === "default_status");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(statusField || { all_fields: fields.map(f=>({name:f.name,field_type:f.field_type})) }, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Debug: show all unique status codes in IT tickets
  if (parsed.pathname === "/debug/statuses") {
    try {
      const tickets = await getTicketsForWorkspace(2);
      const statusCounts = {};
      tickets.forEach(t => {
        const key = t.status;
        statusCounts[key] = (statusCounts[key] || 0) + 1;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        total_it_tickets: tickets.length,
        status_breakdown: statusCounts,
        note: "Standard: 2=Open, 3=Pending, 4=Resolved, 5=Closed. Others are custom."
      }, null, 2));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Fallback proxy
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
  console.log(`   Ticket fields: http://localhost:${PORT}/debug/ticketfields\n`);
});
