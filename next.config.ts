import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['mongoose'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.prairiemoon.com' },
      { protocol: 'https', hostname: '**.wikimedia.org' },
    ],
  },
};

export default nextConfig;
