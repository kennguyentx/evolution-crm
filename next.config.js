/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse']
  },
  // Lint runs in CI (.github/workflows/ci.yml), not during the production build,
  // so a lint nit can never block a deploy. Type-checking still runs in the build.
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
