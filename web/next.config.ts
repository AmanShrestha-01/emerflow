import type { NextConfig } from "next";

// Dev: `next dev` on :3000 forwards /api to the FastAPI backend on :8000.
// Build: NEXT_EXPORT=1 writes a static site to out/, which FastAPI serves (one Cloud Run service).
const exporting = process.env.NEXT_EXPORT === "1";
const backend = process.env.EMERFLOW_BACKEND || "http://localhost:8000";

const nextConfig: NextConfig = exporting
  ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
  : {
      images: { unoptimized: true },
      // gzip buffers the proxied live event stream (/api/events), so the board would only see the 15 s poll.
      compress: false,
      async rewrites() {
        return [
          { source: "/api/:path*", destination: `${backend}/api/:path*` },
          { source: "/p/:token", destination: "/p" }, // patient links: one page reads the token from the URL
        ];
      },
    };

export default nextConfig;
