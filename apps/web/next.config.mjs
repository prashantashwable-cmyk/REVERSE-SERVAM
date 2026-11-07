/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@aiec/domain'],
  // All metadata is static: render it in <head> for every client instead of streaming it
  // through a Suspense outlet (removes a hydration-timing variable seen in E2E runs).
  htmlLimitedBots: /.*/,
  // Technical documents (TE04) are uploaded through a server action that computes their checksum.
  experimental: { serverActions: { bodySizeLimit: '26mb' } },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
