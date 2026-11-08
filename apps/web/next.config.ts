import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The scene and the message lists are one page at /messages; / is the
  // landing page. Not permanent, in case the routes split again.
  async redirects() {
    return [{ source: "/scene", destination: "/messages", permanent: false }];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
