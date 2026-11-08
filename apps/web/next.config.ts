import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The scene and the message lists are one page at / now. Not permanent, in
  // case the routes split again.
  async redirects() {
    return [
      { source: "/messages", destination: "/", permanent: false },
      { source: "/scene", destination: "/", permanent: false },
    ];
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
