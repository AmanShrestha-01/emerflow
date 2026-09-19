import type { NextConfig } from "next";

// Dev: `next dev` on :3000 forwards /api to the FastAPI backend on :8000.
// Build: NEXT_EXPORT=1 writes a static site to out/, which FastAPI serves (one Cloud Run service).
const exporting = process.env.NEXT_EXPORT === "1";
const backend = process.env.EMERFLOW_BACKEND || "http://localhost:8000";

const nextConfig: NextConfig = exporting
  ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
  : {
      images: { unoptimized: true },
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
      },
    };

export default nextConfig;
