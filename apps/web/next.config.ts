import type { NextConfig } from "next";

// Side-effect import so a missing/invalid env var fails the build rather than
// the first request.
import "./src/env";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
