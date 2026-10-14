/** @type {import('next').NextConfig} */
const nextConfig = {
  // O app (tela de login + painel) é uma página estática em /public/index.html;
  // o Next.js cuida das rotas de API seguras (login, IA, Strava).
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
