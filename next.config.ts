import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // better-sqlite3 and the Remotion renderer are native/Node-only; bundling
  // them into the server build breaks their native bindings.
  serverExternalPackages: [
    "better-sqlite3",
    "@remotion/bundler",
    "@remotion/renderer",
  ],

  experimental: {
    // Uploads are streamed to disk, but the action body limit still applies
    // to any form posts.
    serverActions: { bodySizeLimit: "10mb" },
  },

  // The app is reached through the Cloudflare Tunnel, which sets these.
  // Trusting them keeps generated URLs on the public origin.
  poweredByHeader: false,
};

export default nextConfig;
