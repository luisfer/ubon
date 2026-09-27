/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The formbricks shape: browsers refuse * with credentials, so credentialed calls fail.
        source: '/api/client/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' }, // expect-warn: web/cors-credentials-wildcard
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
        ],
      },
      {
        source: '/api/public/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }], // ok: public API without credentials
      },
    ];
  },
};

export default nextConfig;
