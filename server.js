const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const FRESHSERVICE_DOMAIN = "searcheducationtrust.freshservice.com";
const API_KEY = "8qXHhTA54F6QsTyvx0a";
const PORT = 3000;
const WORKSPACE_IDS = [2, 3, 4]; // IT=2, HHS=3, TGS=4

// ── CACHE CONFIG ──────────────────────────────────────────────────────────────
// Data is fetched from Freshservice at most once per interval, then served
// from memory to all dashboard users — dramatically reduces API usage.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const AUTH = "Basic " + Buffer.from(API_KEY + ":X").toString("base64");

const cache = {
  tickets: { data: null, fetchedAt: null },
  agents:  { data: null, fetchedAt: null },
};

function isFresh(entry) {
  return entry.data !== null && entry.fetchedAt !== null &&
    (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

function minutesUntilRefresh(entry) {
  if (!entry.fetchedAt) return 0;
  return Math.max(0, Math.round((CACHE_TTL_MS - (Date.now() - entry.fetchedAt)) / 60000));
}

// ── FRESHSERVICE API ───────────────────────────────────────────────────────────
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
  const ACTIVE_STATUSES = [2, 3, 6, 7];
  // Fetch recent tickets for charts/history
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
  // Fetch ALL active tickets regardless of age
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
  // Merge and deduplicate
  const seen = new Set();
  return [...activeTickets, ...recent].filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

async function getAgentsForWorkspace(workspaceId) {
  const result = await fsRequest(`/agents?per_page=100&active=true&workspace_id=${workspaceId}`);
  const body = result.body;
  return body.agents || (Array.isArray(body) ? body : []);
}

// ── BACKGROUND REFRESH ────────────────────────────────────────────────────────
// Pre-warms the cache on startup and refreshes it in the background every
// 15 minutes. The dashboard never waits for a live fetch — it always gets
// the cached copy instantly.
async function refreshCache() {
  console.log(`[${new Date().toISOString()}] Refreshing cache from Freshservice...`);
  try {
    const ticketResults = await Promise.all(WORKSPACE_IDS.map(id => getTicketsForWorkspace(id)));
    cache.tickets = { data: ticketResults.flat(), fetchedAt: Date.now() };
    console.log(`  Tickets: ${cache.tickets.data.length} loaded`);
  } catch (err) {
    console.error("  Ticket refresh failed:", err.message);
  }
  try {
    const agentResults = await Promise.all(WORKSPACE_IDS.map(id => getAgentsForWorkspace(id)));
    const seen = new Set();
    cache.agents = {
      data: agentResults.flat().filter(a => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      }),
      fetchedAt: Date.now()
    };
    console.log(`  Agents: ${cache.agents.data.length} loaded`);
  } catch (err) {
    console.error("  Agent refresh failed:", err.message);
  }
}

// Initial load then refresh every 15 minutes
refreshCache();
setInterval(refreshCache, CACHE_TTL_MS);

// ── HTTP SERVER ───────────────────────────────────────────────────────────────
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

  // Serve tickets from cache — instant response, no Freshservice call
  if (parsed.pathname === "/api/alltickets") {
    if (!cache.tickets.data) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cache warming up, please wait a moment and refresh." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      tickets: cache.tickets.data,
      total: cache.tickets.data.length,
      cached_at: new Date(cache.tickets.fetchedAt).toISOString(),
      refreshes_in_minutes: minutesUntilRefresh(cache.tickets),
    }));
    return;
  }

  // Serve agents from cache
  if (parsed.pathname === "/api/allagents") {
    if (!cache.agents.data) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cache warming up, please wait a moment and refresh." }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agents: cache.agents.data,
      cached_at: new Date(cache.agents.fetchedAt).toISOString(),
    }));
    return;
  }

  // Force a manual cache refresh (useful after making changes in Freshservice)
  if (parsed.pathname === "/api/refresh") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Cache refresh started in background." }));
    refreshCache();
    return;
  }

  // Cache status
  if (parsed.pathname === "/debug/cache") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      tickets: {
        count: cache.tickets.data?.length || 0,
        cached_at: cache.tickets.fetchedAt ? new Date(cache.tickets.fetchedAt).toISOString() : null,
        refreshes_in_minutes: minutesUntilRefresh(cache.tickets),
      },
      agents: {
        count: cache.agents.data?.length || 0,
        cached_at: cache.agents.fetchedAt ? new Date(cache.agents.fetchedAt).toISOString() : null,
      }
    }, null, 2));
    return;
  }

  // Debug endpoints
  if (parsed.pathname === "/debug/sample") {
    const tickets = cache.tickets.data || [];
    const statusCounts = {};
    [2,3,4].forEach(wsId => {
      const ws = tickets.filter(t => t.workspace_id === wsId);
      const counts = {};
      ws.forEach(t => { counts[t.status] = (counts[t.status]||0)+1; });
      statusCounts[`workspace_${wsId}`] = { total: ws.length, by_status: counts };
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(statusCounts, null, 2));
    return;
  }

  if (parsed.pathname === "/debug/statuses") {
    const tickets = cache.tickets.data?.filter(t => t.workspace_id === 2) || [];
    const counts = {};
    tickets.forEach(t => { counts[t.status] = (counts[t.status]||0)+1; });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total_it_tickets: tickets.length, status_breakdown: counts }, null, 2));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n✅  Freshservice Dashboard: http://localhost:${PORT}`);
  console.log(`   Cache status : http://localhost:${PORT}/debug/cache`);
  console.log(`   Manual refresh: http://localhost:${PORT}/api/refresh\n`);
});
