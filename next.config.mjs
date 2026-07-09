/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', '@jsquash/webp', '@jsquash/jpeg'],
  outputFileTracingIncludes: {
    '/api/download': [
      './node_modules/@jsquash/webp/codec/dec/*.wasm',
      './node_modules/@jsquash/jpeg/codec/enc/*.wasm',
    ],
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
