// Side-effect import: validates env vars at the very start of any build/dev.
// If env is invalid, build fails with a clear Zod message before Next does anything.
import './src/lib/env';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
