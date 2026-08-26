import withPWA from 'next-pwa';

const pwa = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    { urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts', expiration: { maxEntries: 20 } } }
  ]
});

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { esmExternals: 'loose' },
  async headers() { return [{ source: '/(.*)', headers: securityHeaders }]; },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  }
};

export default pwa(nextConfig);
