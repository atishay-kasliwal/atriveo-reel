# Atriveo Reel

Paste two videos, pick two moments, get a vertical comparison reel.

Atriveo Reel is a focused utility, not a video editor. The whole flow is:

```
Paste URL A → Paste URL B → Pick two clips → Choose a layout
    → Add optional text/pause → Create Reel → Download 1080×1920 MP4
```

It is designed to be self-hosted on a single Mac. The web app, the API, and the
render worker all run on the same machine, reached through a Cloudflare Tunnel.

---

## What it produces

| | |
|---|---|
| Resolution | 1080 × 1920 (9:16) |
| Frame rate | 30 fps |
| Video | H.264 (hardware-encoded via VideoToolbox) |
| Audio | AAC 192 kbps, 48 kHz |
| Container | MP4, `faststart` for instant playback |

Source aspect ratios are always preserved. Clips are cropped or letterboxed to
fit their slot, never stretched.

### Layouts

| Layout | Behaviour |
|---|---|
| **Sequential** | A plays, then B. Optional pause and text card between them. |
| **Top / Bottom** | Both clips play at once, stacked vertically. |
| **Side by Side** | Both clips play at once, side by side. |

In the split layouts, the shorter clip freezes on its last frame so the pane
never goes blank mid-comparison.

---

## Requirements

- **macOS** on Apple silicon (Intel works; encoding is slower)
- **Node.js 20+**
- **FFmpeg** — `brew install ffmpeg`
- **yt-dlp** — `brew install yt-dlp`

Verify:

```bash
node --version && ffmpeg -version | head -1 && yt-dlp --version
```

---

## Quick start

```bash
git clone https://github.com/atishay-kasliwal/atriveo-reel.git
cd reels
npm install
cp .env.example .env

# Generate a session secret and put it in .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm run dev:all      # web + worker together
```

Open http://localhost:3000.

`npm run dev:all` runs the Next.js app and the render worker in one terminal.
They are separate processes; run them individually with `npm run dev` and
`npm run dev:worker` if you prefer separate logs.

---

## Configuration

All settings live in `.env`. See [`.env.example`](.env.example) for the full
list. The ones that matter most:

| Variable | Default | Notes |
|---|---|---|
| `APP_PORT` | `3000` | Port the web app listens on. The tunnel points here. |
| `APP_PASSWORD` | — | Shared password. **Empty disables auth entirely.** |
| `SESSION_SECRET` | — | Signs the session cookie. Generate a random value. |
| `DATA_DIR` | `~/reels-data` | All sources, renders, and the database. |
| `MAX_CONCURRENT_RENDERS` | `1` | Keep at 1 on a Mac Mini. |
| `VIDEO_ENCODER` | `h264_videotoolbox` | Hardware encoder. `libx264` is slower but compresses slightly better. |
| `VIDEO_QUALITY` | `8M` | Bitrate for VideoToolbox, or a CRF value for libx264. |
| `SOURCE_RETENTION_DAYS` | `7` | Downloaded sources older than this are cleaned up. |
| `RENDER_RETENTION_DAYS` | `0` | `0` means finished reels are **never** auto-deleted. |

The app binds to `127.0.0.1` by default. It is reached through the Cloudflare
Tunnel, so there is no reason to expose it on the LAN. Override with
`APP_HOSTNAME` if you need to.

---

## Architecture

```
Browser
   │  HTTPS via Cloudflare Tunnel
   ▼
Next.js app + API  ──writes──►  SQLite  ◄──polls──  Render worker
   │                                                     │
   │                                                     ▼
   └──────── serves finished MP4 ◄──────────── FFmpeg + Remotion
```

The web process **never renders**. It writes a job row and returns; the worker
picks it up independently. That is what keeps a long render from blocking an
HTTP request, and what lets a render survive a browser refresh.

### Where things live

```
src/
├── app/             Next.js routes and API endpoints
├── components/      UI — one file per step of the flow
├── lib/
│   ├── shared/      Reel document model (the render contract), config, errors
│   ├── db/          SQLite schema and queries
│   ├── storage/     Storage abstraction + local filesystem implementation
│   ├── media/       Media providers (YouTube, upload) behind one interface
│   ├── renderer/    FFmpeg filter graphs, pipeline, RenderWorker
│   └── queue/       Job claiming, retries, crash recovery
├── remotion/        Text card compositions
└── worker/          Worker process entry point
```

### Key design decisions

**FFmpeg does the video, Remotion does the text.** Remotion renders by
screen-capturing headless Chrome, which is far slower than FFmpeg for plain
cuts. It earns its place only for text, where it gives real typography and
automatic wrapping. Text cards are rendered to transparent PNGs and composited
by FFmpeg.

> On the stock Homebrew FFmpeg for macOS, `drawtext` (needs libfreetype) and the
> SVG decoder (needs librsvg) are both absent. Remotion is therefore the only
> working text path. If Remotion fails, the reel still renders — the text card
> becomes a plain coloured frame rather than failing the whole job.

**Sources are downloaded whole, not in sections.** `yt-dlp --download-sections`
re-bases timestamps to zero and would need re-fetching every time a selection
changed. One full download, cached and reused across edits, is faster in
practice.

**The concurrency limit is enforced in SQL.** A worker claims a job with
`UPDATE ... WHERE status = 'queued'`. If two workers race, only one row changes.
No in-process lock can be bypassed by starting a second worker.

**Progress is real, and the ETA is honest.** Estimates come from timings this
machine actually recorded for previous renders, blended with the live rate of
the current run. Before enough history exists, the UI shows "Rendering…" rather
than a fabricated countdown.

### Swapping in a cloud renderer later

Implement [`RenderWorker`](src/lib/renderer/worker.ts):

```ts
interface RenderWorker {
  render(job, onProgress, signal): Promise<RenderResult>;
  healthCheck(): Promise<{ healthy: boolean; reason?: string }>;
}
```

Pass the new implementation to `RenderQueue`. The API, database, and UI don't
change. `Storage` is similarly abstracted for a move to R2/S3.

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for running as a persistent
service via `launchd` and routing `reels.atriveo.com` through the Cloudflare
Tunnel.

For hosting off-premises instead, [docs/DEPLOYMENT-oracle.md](docs/DEPLOYMENT-oracle.md)
covers an always-free Oracle Ampere instance running the Docker Compose stack,
including the two things that genuinely differ there: software encoding in
place of VideoToolbox, and YouTube's bot gate on datacenter IPs.

Short version:

```bash
npm run build
./scripts/install-service.sh     # installs and starts both launchd services
```

Then point the tunnel at `http://localhost:3000`. **Only the web app should be
routed — never expose the worker.**

---

## Storage and cleanup

```
~/reels-data/
├── sources/     Downloaded and uploaded source videos
├── renders/     Finished MP4s
├── temp/        Per-job scratch space
└── reels.db     SQLite database
```

Temp files are removed after each successful render. Source videos are cleaned
up after `SOURCE_RETENTION_DAYS`, except any a saved reel still references.
Finished renders are kept forever unless you set `RENDER_RETENTION_DAYS` —
deleting someone's finished work to save disk is not a default worth having.

---

## Testing

```bash
npm test          # unit tests (filter graph geometry, timecodes, validation)
npm run typecheck
```

---

## Legal

You are responsible for having the rights to any media you process with this
tool. It does not circumvent DRM, access private content, or bypass platform
restrictions; it uses `yt-dlp` against publicly accessible URLs.

## License

MIT
