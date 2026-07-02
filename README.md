# SET Freshdesk Dashboard

Live helpdesk dashboard for Search Education Trust, powered by the Freshdesk API.

## Requirements

- Node.js 14 or higher (no npm packages needed — uses Node built-ins only)

## Setup & Run

1. **Unzip** this folder somewhere on your machine or server.

2. **Start the server:**
   ```bash
   node server.js
   ```

3. **Open your browser** and go to:
   ```
   http://localhost:3000
   ```

That's it — the dashboard will load your live Freshdesk data automatically.

## Deploying to a server

To host this permanently (so your team can access it):

1. Copy the folder to your server (e.g. via SCP or FTP).
2. Install [PM2](https://pm2.keymetrics.io/) to keep it running:
   ```bash
   npm install -g pm2
   pm2 start server.js --name freshdesk-dashboard
   pm2 save
   ```
3. Point a domain/subdomain to your server's IP and use Nginx or Caddy
   to reverse-proxy port 3000.

## Configuration

Edit the top of `server.js` to change:
- `FRESHDESK_DOMAIN` — your Freshdesk subdomain
- `API_KEY` — your Freshdesk API key
- `PORT` — default is 3000

## Features

- Live ticket metrics (open, resolved, urgent)
- New vs resolved trend chart
- Priority breakdown doughnut chart
- Status breakdown with visual bars
- Agent performance table
- 7 day / 30 day / all-time filters
- Auto-refreshes every 2 minutes
