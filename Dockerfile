# Linux image for Atriveo Reel. See docker-compose.yml for why the Mac Mini
# deployment runs natively instead.

FROM node:22-bookworm-slim

# ffmpeg for rendering, yt-dlp for fetching sources, and the libraries
# Remotion's headless Chrome needs to start.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
      fonts-liberation \
      libnss3 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libxkbcommon0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libgbm1 \
      libasound2 \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so a source change doesn't invalidate this layer.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

RUN npm run build

# Storage lives on a mounted volume, not in the image.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

CMD ["npm", "run", "start"]
