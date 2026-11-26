/** @type {import('next').NextConfig} */
export default {
  ...(process.env.OPENPANELX_STANDALONE === "1" ? { output: "standalone" } : {}),
  poweredByHeader: false,
  // Hides Next.js's floating "N" developer badge in `npm run dev`. It is not part of the panel.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
