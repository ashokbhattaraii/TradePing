import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@tradeping/types'],
};

export default nextConfig;
