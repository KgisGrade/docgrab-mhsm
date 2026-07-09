/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'sharp'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
