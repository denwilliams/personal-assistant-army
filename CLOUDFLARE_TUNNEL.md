# Cloudflare Tunnel Setup

Expose your local Bun server via Cloudflare Tunnel.

## One-time Setup

```bash
# Install cloudflared
brew install cloudflared

# Authenticate (opens browser)
cloudflared tunnel login
```

## Create a Tunnel

```bash
# Create a named tunnel
cloudflared tunnel create personal-assistant-army

# This creates a credentials file at ~/.cloudflared/<TUNNEL_ID>.json
```

## Configure

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /path/to/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: army.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

## Route DNS

```bash
cloudflared tunnel route dns <TUNNEL_ID> army.yourdomain.com
```

## Run

```bash
# Start your app
bun run index.ts &

# Start the tunnel
cloudflared tunnel run personal-assistant-army
```

## Quick & Dirty (No Config)

Skip all setup and get a temporary public URL:

```bash
cloudflared tunnel --url http://localhost:3000
```

This gives you a random `https://*.trycloudflare.com` URL immediately. No login, no config, no DNS.

## Notes

- Cloudflare Tunnel proxies TCP, so SSE streaming works without changes.
- HTTPS is handled by Cloudflare — your Bun server stays HTTP on localhost.
- Cookie `secure: true` will work since the tunnel serves HTTPS to clients.
- The `idleTimeout: 120` in Bun server config ensures long-running agent streams don't get killed server-side. Cloudflare's proxy timeout is 100 seconds for HTTP, but streaming responses where bytes keep flowing are not subject to that idle timeout.
- For persistent use, run as a service: `cloudflared service install`
