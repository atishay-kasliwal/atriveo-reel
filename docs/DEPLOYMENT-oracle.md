# Deploying Atriveo Reel on Oracle Cloud Free Tier

An alternative to the Mac Mini deployment in [DEPLOYMENT.md](DEPLOYMENT.md).
The app moves to an always-free Ampere A1 instance and reaches the internet
through a Cloudflare Tunnel of its own, so the Mac stops being part of the
serving path.

```
https://reels.atriveo.com
        │
        ▼
Cloudflare edge
        │  (outbound tunnel — no ports opened, no ingress rules)
        ▼
cloudflared container on the Oracle instance
        │
        ▼
web:3000                  ← Next.js web + API, on the compose network
        │
        │  SQLite + filesystem, on a shared volume
        ▼
worker                    ← never exposed to the internet
```

---

## What actually changes

| | Mac Mini | Oracle Ampere A1 |
|---|---|---|
| Encoder | `h264_videotoolbox` (hardware) | `libx264` (software) — several times slower |
| Architecture | arm64 (Apple silicon) | arm64 (Ampere) — same, so no emulation |
| Process model | `launchd` services, native | Docker Compose |
| YouTube fetching | residential IP, works untouched | datacenter IP, **frequently bot-gated** |
| Public routing | tunnel on the Mac | tunnel container on the instance |
| Storage | whatever the Mac has | 200 GB always-free block storage |

The encoder change is a real regression and the YouTube one is a real risk.
Both are covered below. Everything else is a straight port — the app is
already architecture-agnostic, and the Dockerfile's base image, ffmpeg, and
yt-dlp all have native arm64 builds.

---

## 1. Create the instance

Always Free gives you 4 Ampere OCPUs and 24 GB of RAM to divide among ARM
instances, 200 GB of block storage, and 10 TB of egress a month. Put it all in
one instance.

Console → Compute → Instances → Create instance:

| Field | Value |
|---|---|
| Image | Ubuntu 24.04 (**aarch64** build) |
| Shape | `VM.Standard.A1.Flex` |
| OCPUs | 4 |
| Memory | 24 GB |
| Boot volume | 200 GB |
| SSH keys | upload your public key |

Leave the networking defaults alone. **Do not add ingress rules** — the tunnel
dials out, so nothing needs to reach the instance from outside. That is the
main security benefit of keeping Cloudflare in the path, and it also sidesteps
the restrictive `iptables` rules Oracle's Ubuntu images ship with, which
otherwise surprise people who open a port in the security list and find it
still unreachable.

Two things worth knowing before you rely on this box:

- **"Out of host capacity" is common.** Ampere A1 is heavily oversubscribed in
  the popular free regions. Retry, or try a different availability domain.
- **Free accounts reclaim idle Always Free instances after 7 days.** Upgrading
  to pay-as-you-go stops that and improves capacity access, and you are still
  billed nothing while you stay inside the Always Free limits. If this is
  going to serve a real domain, upgrade.

---

## 2. Install Docker

```bash
ssh ubuntu@<instance-public-ip>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
```

Log out and back in so the group membership applies, then confirm:

```bash
docker run --rm hello-world
```

---

## 3. Get the app onto the instance

The repository is private, so HTTPS cloning would prompt for credentials the
instance has no way to answer. Give it a read-only deploy key instead, which
also leaves `git pull` working for later updates.

On the instance, generate a key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "reels-oracle-deploy"
cat ~/.ssh/github_deploy.pub
```

Add that public key to the repository — GitHub → the repo → Settings → Deploy
keys → Add, leaving "Allow write access" unchecked. Or from a machine with the
`gh` CLI authenticated:

```bash
gh repo deploy-key add key.pub --title "reels-oracle (read-only)" \
  --repo atishay-kasliwal/atriveo-reel
```

Then clone over SSH and make the key stick for future pulls:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes" \
  git clone git@github.com:atishay-kasliwal/atriveo-reel.git ~/reels
cd ~/reels
git config core.sshCommand "ssh -i ~/.ssh/github_deploy -o IdentitiesOnly=yes"
cp .env.example .env
```

Edit `.env`. The values that differ from the Mac deployment:

```bash
APP_PASSWORD=<a long random password>
SESSION_SECRET=<output of the command below>

# VideoToolbox is macOS-only. On Linux this must change, and VIDEO_QUALITY
# switches meaning with it: a CRF value, not a bitrate.
VIDEO_ENCODER=libx264
VIDEO_QUALITY=20

# Four cores, and libx264 already threads across all of them. Two concurrent
# renders would each get half a machine and finish no sooner.
MAX_CONCURRENT_RENDERS=1

# Filled in at step 4.
TUNNEL_TOKEN=
```

Generate the session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or, without node installed on the host:
openssl rand -hex 32
```

`DATA_DIR` is ignored by the containers — compose mounts the `reels-data`
volume at `/data` and sets it there.

Build and start the app, without the tunnel for now:

```bash
docker compose up -d --build
curl -I http://localhost:3000     # expect a 307 to /login
```

The first build takes a while: it compiles the app and pulls Debian's ffmpeg.

---

## 4. Create a tunnel for this instance

**Create a new tunnel — do not reuse the Mac Mini's.** cloudflared treats two
connectors sharing a tunnel ID as a high-availability pair, and Cloudflare will
balance requests between them. During a migration that means some requests
land on the Mac and some on Oracle, with two SQLite databases diverging behind
them.

Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared, name it
something like `reels-oracle`. On the install screen, copy the token out of the
displayed command — the long string after `--token`.

Put it in `.env`:

```bash
TUNNEL_TOKEN=<the token>
```

Then add a public hostname to the tunnel:

| Field | Value |
|---|---|
| Subdomain | `reels` |
| Domain | `atriveo.com` |
| Type | `HTTP` |
| URL | `web:3000` |

`web:3000` rather than `localhost:3000` — cloudflared runs in a container and
reaches the app over the compose network by service name.

Under **Additional application settings → TLS**, leave defaults; the app speaks
plain HTTP inside the network. Renders stream progress over Server-Sent
Events, so if you set a connect timeout, keep it generous (30s).

Start the tunnel:

```bash
docker compose --profile tunnel up -d
docker compose logs -f tunnel      # expect "Registered tunnel connection"
```

---

## 5. Cut over

Adding the hostname to the new tunnel updates the DNS record for
`reels.atriveo.com` to point at the new tunnel. Before that takes effect
cleanly, remove the `reels.atriveo.com` public hostname from the **Mac Mini's**
tunnel — otherwise the two tunnels compete for the same record and Cloudflare
will refuse the change or leave a stale route.

Order that works:

1. On the Mac: `launchctl stop com.atriveo.reel.tunnel`
2. Zero Trust → the Mac's tunnel → remove the `reels.atriveo.com` hostname
3. Add the hostname to `reels-oracle` as in step 4
4. `curl -I https://reels.atriveo.com`

If you have finished reels on the Mac worth keeping, copy the data across
before the cutover:

```bash
# On the Mac, with both services stopped so SQLite is quiescent:
launchctl stop com.atriveo.reel.web && launchctl stop com.atriveo.reel.worker
tar czf reels-data.tar.gz -C ~ reels-data
scp reels-data.tar.gz ubuntu@<instance-ip>:~

# On the instance:
docker compose down
tar xzf reels-data.tar.gz
docker run --rm -v reels-data:/data -v ~/reels-data:/src alpine \
  sh -c "cp -a /src/. /data/"
docker compose --profile tunnel up -d
```

---

## 6. The YouTube bot gate

This is the part most likely to bite you. YouTube challenges requests from
known datacenter ranges — Oracle's included — with "Sign in to confirm you're
not a bot". The same yt-dlp invocation that never fails from the Mac's home
connection can fail constantly from the instance.

The app detects this specific failure and says so plainly rather than blaming
the link, so you will know when it starts. Uploads are unaffected; only
YouTube URLs are.

Observed behaviour on an Oracle Ashburn instance: the gate is per-video, not a
blanket block on the address. Some videos resolve normally while others are
refused, so a working test proves nothing about the next request.

The fix is to give yt-dlp a signed-in cookie jar. Export it in a private
window, in this order — the sequence is what decides whether the cookie lasts
months or days:

1. Open a new incognito/private window.
2. Sign into YouTube with a throwaway account.
3. Go to `https://www.youtube.com/robots.txt`, a page that will not rotate the
   auth tokens under you.
4. Export cookies for `youtube.com` in Netscape format with a cookies.txt
   browser extension.
5. Close the window **without signing out**. Signing out invalidates the
   cookie that was just exported; closing the window leaves it valid.

Never open that account in a normal window afterwards. Ordinary browsing
rotates the tokens and invalidates the server's copy.

Then install it:

```bash
scp cookies.txt ubuntu@<instance-ip>:~
# Into the shared volume, where both containers can read it:
docker run --rm -v reels-data:/data -v ~/cookies.txt:/src.txt:ro alpine \
  cp /src.txt /data/cookies.txt
```

Set it in `.env` and restart:

```bash
YTDLP_COOKIES=/data/cookies.txt
```

```bash
docker compose --profile tunnel up -d
```

Three caveats worth taking seriously:

- **Cookies expire**, typically within weeks to months. When downloads start
  failing again, re-export.
- **Use a throwaway Google account.** The cookie sits on a cloud host
  indefinitely, and anyone who reaches that host can act as the account it
  belongs to. Do not use an account you care about.
- **It is not a guaranteed fix.** Persistent bot-gating from a given IP
  sometimes continues regardless, in which case the options are a residential
  proxy, uploading files instead of pasting links, or keeping fetching on the
  Mac.

---

## 7. Smoke-test before trusting it

In order, because each step exercises something the previous one didn't:

```bash
# 1. App answers and auth works
curl -I https://reels.atriveo.com

# 2. yt-dlp works from this IP at all — the bot gate shows up here first
docker compose exec worker yt-dlp --dump-json --no-warnings \
  "https://www.youtube.com/watch?v=<some-id>" | head -c 200

# 3. ffmpeg has the software encoder
docker compose exec worker ffmpeg -hide_banner -encoders | grep libx264
```

Then, in the browser, build a reel **that includes an intro or outro text
card** and render it. Text cards go through Remotion, which downloads a
headless Chrome on first use — that download is the least standard part of the
arm64 story and the thing most likely to need attention. Watch it happen:

```bash
docker compose logs -f worker
```

A blank text card, or a render that fails once Remotion starts, means Chrome
couldn't launch; the worker log names the cause.

Time a render against what the Mac took, so you know what you traded.

---

## Updating

```bash
cd ~/reels
git pull
docker compose --profile tunnel up -d --build
```

The volume persists across rebuilds, so projects, sources, and finished reels
survive.

---

## Troubleshooting

**502 from Cloudflare** — the tunnel is up but can't reach the app. Check the
hostname's URL is `web:3000`, not `localhost:3000`. `docker compose ps` should
show `web` running.

**Tunnel container restarts in a loop** — almost always a bad or expired
`TUNNEL_TOKEN`. `docker compose logs tunnel` says so explicitly.

**Renders stay "queued"** — the worker isn't running or crashed:
`docker compose logs worker`.

**Downloads fail with a bot-gate message** — section 6.

**Renders are much slower than expected** — confirm `VIDEO_ENCODER=libx264` is
actually in effect and not still set to `h264_videotoolbox`, which fails rather
than falling back: `docker compose exec worker printenv VIDEO_ENCODER`.

**Instance disappeared** — a free-tier account reclaimed it as idle. Section 1.

**Disk filling up** — `docker system df` and
`docker compose exec worker du -sh /data/*`. Lower `SOURCE_RETENTION_DAYS`.

---

## Falling back to the Mac

Nothing about this is one-way. The Mac's `launchd` services and its tunnel are
untouched by any of the above; to go back, move the `reels.atriveo.com`
hostname to the Mac's tunnel and start the services again:

```bash
launchctl start com.atriveo.reel.web
launchctl start com.atriveo.reel.worker
launchctl start com.atriveo.reel.tunnel
```
