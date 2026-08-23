import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  logging: {
    incomingRequests: {
      ignore: [/\/api\/auth\/callback(?:\/)?(?:\?.*)?$/],
    },
  },
  reactStrictMode: true,
};

export default nextConfig;
