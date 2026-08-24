# Deploying Atriveo Reel on a Mac Mini

> For hosting on a cloud instance rather than at home, see
> [DEPLOYMENT-oracle.md](DEPLOYMENT-oracle.md).

The Mac Mini runs everything: the web app, the API, and the render worker. It
is reached from the internet through an existing Cloudflare Tunnel.

```
https://reels.atriveo.com
        │
        ▼
Cloudflare edge
        │  (outbound tunnel — no ports opened, no port forwarding)
        ▼
cloudflared on the Mac Mini
        │
        ▼
http://localhost:3000     ← Next.js web + API
        │
        │  SQLite + filesystem
        ▼
Render worker             ← never exposed to the internet
```

---

## 1. Install prerequisites

```bash
brew install node ffmpeg yt-dlp
```

Confirm the hardware encoder is present — it's what makes renders fast:

```bash
ffmpeg -hide_banner -encoders | grep h264_videotoolbox
```

If that prints nothing, set `VIDEO_ENCODER=libx264` in `.env`. Renders will be
slower but still correct.

---

## 2. Get the app onto the machine

```bash
git clone https://github.com/atishay-kasliwal/atriveo-reel.git ~/reels
cd ~/reels
npm ci
cp .env.example .env
```

Edit `.env`:

```bash
APP_PORT=3000
APP_PASSWORD=<a long random password>
SESSION_SECRET=<output of the command below>
DATA_DIR=~/reels-data
```

Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Build:

```bash
npm run build
```

---

## 3. Run as a persistent service

Two `launchd` services: one for the web app, one for the worker. They restart
on crash and start automatically at login.

```bash
./scripts/install-service.sh
```

That script generates both plists with the correct absolute paths, loads them,
and starts them.

Check they're running:

```bash
launchctl list | grep atriveo
tail -f ~/Library/Logs/atriveo-reel/web.log
tail -f ~/Library/Logs/atriveo-reel/worker.log
```

Confirm the app answers locally:

```bash
curl -I http://localhost:3000
```

### Managing the services

```bash
launchctl stop com.atriveo.reel.web
launchctl start com.atriveo.reel.web

# After pulling changes:
cd ~/reels && git pull && npm ci && npm run build
launchctl stop com.atriveo.reel.web && launchctl start com.atriveo.reel.web
launchctl stop com.atriveo.reel.worker && launchctl start com.atriveo.reel.worker

# Remove entirely:
./scripts/uninstall-service.sh
```

> **A note on `launchd` and Homebrew:** `launchd` services do not inherit your
> shell's `PATH`, so `ffmpeg` and `yt-dlp` would not be found. The generated
> plists set `PATH` explicitly to include `/opt/homebrew/bin`. If you installed
> Homebrew somewhere else, edit `scripts/install-service.sh` before running it.

---

## 4. Route the domain through the Cloudflare Tunnel

The tunnel is already running on this machine. Add a hostname to it — do not
create a second tunnel.

### Using the dashboard

Zero Trust → Networks → Tunnels → your tunnel → **Public Hostname** → Add:

| Field | Value |
|---|---|
| Subdomain | `reels` |
| Domain | `atriveo.com` |
| Type | `HTTP` |
| URL | `localhost:3000` |

Save. DNS is created automatically.

### Using a config file

If your tunnel is configured through `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: reels.atriveo.com
    service: http://localhost:3000
    originRequest:
      # Renders stream progress over Server-Sent Events; a short idle
      # timeout would cut the connection mid-render.
      disableChunkedEncoding: false
      connectTimeout: 30s
      noTLSVerify: false

  # Existing hostnames go here.

  - service: http_status:404
```

Then restart the tunnel:

```bash
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
# or, if you run it manually:
cloudflared tunnel run <your-tunnel>
```

Verify:

```bash
curl -I https://reels.atriveo.com
```

**Only route the web app.** The render worker listens on no port at all — it
communicates through SQLite and the filesystem — so there is nothing to expose,
and nothing should be added to the tunnel for it.

---

## 5. Optional: Cloudflare Access instead of the app password

For a stronger gate, put Cloudflare Access in front of the hostname and let the
edge authenticate you before traffic reaches the Mac:

Zero Trust → Access → Applications → Add → Self-hosted, domain
`reels.atriveo.com`, with a policy allowing your email.

You can then leave `APP_PASSWORD` empty, since Cloudflare handles auth. Only do
that if Access is definitely active — an empty `APP_PASSWORD` disables the
app's own auth entirely.

---

## Keeping the Mac awake

A sleeping Mac Mini can't serve requests or render:

```bash
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
# Recover automatically after a power cut:
sudo pmset -a autorestart 1
```

---

## Troubleshooting

**502 from Cloudflare** — the app isn't running or is on a different port.
Check `launchctl list | grep atriveo` and `curl -I http://localhost:3000`.

**Renders stay "queued" forever** — the worker isn't running. Check
`~/Library/Logs/atriveo-reel/worker.log`.

**"Video tooling isn't installed"** — `launchd` can't find `ffmpeg` or
`yt-dlp`. Confirm the `PATH` in the plists matches your Homebrew prefix
(`brew --prefix`).

**Text cards render blank** — Remotion couldn't run. It downloads a headless
Chrome (~93 MB) on first use, which needs network access. The worker log names
the cause.

**YouTube downloads fail suddenly** — YouTube changed something; yt-dlp updates
often. `brew upgrade yt-dlp`.

**Disk filling up** — check `du -sh ~/reels-data/*`. Lower
`SOURCE_RETENTION_DAYS`, or set `RENDER_RETENTION_DAYS` if you don't need to
keep old reels.

---

## Docker

Rendering here depends on VideoToolbox, the Mac's hardware video encoder.
Docker Desktop on macOS runs containers inside a Linux VM with **no access to
it**, so a containerised worker would silently fall back to software encoding
and be several times slower.

For that reason the worker is intended to run natively on macOS. A
`docker-compose.yml` is provided for running the **web app** in a container
during development, or for deploying the whole stack to a Linux host, where
`VIDEO_ENCODER=libx264` applies.
