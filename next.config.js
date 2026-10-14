const { execSync } = require("child_process");
const { version } = require("./package.json");

// Versão mostrada no rodapé: número do package.json + commit + data do build.
const commit = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return ""; }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { APP_VERSION: version, APP_COMMIT: commit, APP_BUILT_AT: new Date().toISOString() },
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
