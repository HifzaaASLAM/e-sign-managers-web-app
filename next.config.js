const shmBuildId =
  process.env.NEXT_PUBLIC_SHM_BUILD_ID ||
  process.env.SHM_BUILD_ID ||
  String(Date.now());

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  env: {
    NEXT_PUBLIC_SHM_BUILD_ID: shmBuildId,
  },
  typescript: {
    // Recovered workspace may still have residual type drift; keep Hostinger deploy shipping.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    domains: [],
  },
  experimental: {
    // Hostinger shared build hosts hit process/thread limits during "Collecting page data"
    // when Prisma's query engine starts (os error 11). Keep static generation single-threaded.
    cpus: 1,
    workerThreads: false,
    optimizePackageImports: ["lucide-react"],
    serverComponentsExternalPackages: ["docxtemplater", "pizzip"],
    outputFileTracingIncludes: {
      "/sign-document": [
        "./lib/shm/templates/tenant-application.html",
        "./lib/shm/templates/property-management-agreement.html",
        "./lib/shm/templates/tenant-agreement.html",
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
        "./lib/shm/templates/ownership-statement.html",
        "./lib/shm/templates/landlord-weekly-report.html",
        "./lib/shm/templates/pm-takeover-form.html",
        "./lib/shm/templates/pm-takeover-form-template.docx",
        "./public/shm-plugin-assets/templates/pm-takeover-form-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/images/tenant-agreement-ref-1.png",
        "./public/shm-plugin-assets/signing.css",
      ],
      "/signing-frame": [
        "./lib/shm/templates/tenant-application.html",
        "./lib/shm/templates/property-management-agreement.html",
        "./lib/shm/templates/tenant-agreement.html",
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
        "./lib/shm/templates/ownership-statement.html",
        "./lib/shm/templates/landlord-weekly-report.html",
        "./lib/shm/templates/pm-takeover-form.html",
        "./lib/shm/templates/pm-takeover-form-template.docx",
        "./public/shm-plugin-assets/templates/pm-takeover-form-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/images/tenant-agreement-ref-1.png",
        "./public/shm-plugin-assets/signing.css",
      ],
      "/api/shm-docs/ownership-statement/admin-send": [
        "./lib/shm/templates/ownership-statement-template.docx",
        "./lib/shm/templates/ownership-statement-header.png",
        "./public/shm-plugin-assets/templates/ownership-statement-template.docx",
        "./public/shm-plugin-assets/images/ownership-statement-header.png",
        "./public/shm-plugin-assets/images/image1.png",
      ],
      "/shm-docs/ownership-statement/admin-send": [
        "./lib/shm/templates/ownership-statement-template.docx",
        "./lib/shm/templates/ownership-statement-header.png",
        "./public/shm-plugin-assets/templates/ownership-statement-template.docx",
        "./public/shm-plugin-assets/images/ownership-statement-header.png",
        "./public/shm-plugin-assets/images/image1.png",
      ],
      "/api/shm-docs/tenant-agreement/generate-pdf": [
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
      ],
      "/shm-docs/tenant-agreement/generate-pdf": [
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
      ],
      "/api/shm-docs/tenant-agreement/admin-send": [
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
      ],
      "/shm-docs/tenant-agreement/admin-send": [
        "./lib/shm/templates/tenant-agreement-template.docx",
        "./public/shm-plugin-assets/templates/tenant-agreement-template.docx",
      ],
      "/api/shm-docs/property-management-agreement/generate-pdf": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
      ],
      "/shm-docs/property-management-agreement/generate-pdf": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
      ],
      "/api/dashboard/documents/[documentId]/file": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
      ],
      "/api/shm-docs/property-management-agreement/submit": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
      ],
      "/shm-docs/property-management-agreement/submit": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
        "./lib/shm/templates/property-management-agreement-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-template.docx",
      ],
      "/api/shm-docs/property-management-agreement/admin-send": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
      ],
      "/shm-docs/property-management-agreement/admin-send": [
        "./lib/shm/templates/property-management-agreement-professional-template.docx",
        "./public/shm-plugin-assets/templates/property-management-agreement-professional-template.docx",
      ],
      "/api/shm-docs/pm-takeover/generate-pdf": [
        "./lib/shm/templates/pm-takeover-form-template.docx",
        "./public/shm-plugin-assets/templates/pm-takeover-form-template.docx",
      ],
      "/shm-docs/pm-takeover/generate-pdf": [
        "./lib/shm/templates/pm-takeover-form-template.docx",
        "./public/shm-plugin-assets/templates/pm-takeover-form-template.docx",
      ],
      "/api/shm-docs/ownership-statement/preview": [
        "./lib/shm/templates/ownership-statement-template.docx",
        "./lib/shm/templates/ownership-statement-header.png",
        "./public/shm-plugin-assets/templates/ownership-statement-template.docx",
        "./public/shm-plugin-assets/images/ownership-statement-header.png",
        "./public/shm-plugin-assets/images/image1.png",
      ],
      "/shm-docs/ownership-statement/preview": [
        "./lib/shm/templates/ownership-statement-template.docx",
        "./lib/shm/templates/ownership-statement-header.png",
        "./public/shm-plugin-assets/templates/ownership-statement-template.docx",
        "./public/shm-plugin-assets/images/ownership-statement-header.png",
        "./public/shm-plugin-assets/images/image1.png",
      ],
      "/api/shm-docs/landlord-weekly-report/admin-send": [
        "./lib/shm/templates/landlord-weekly-report-template.pdf",
        "./public/shm-plugin-assets/templates/landlord-weekly-report-template.pdf",
        "./lib/shm/templates/landlord-weekly-report-template.docx",
        "./public/shm-plugin-assets/templates/landlord-weekly-report-template.docx",
      ],
      "/shm-docs/landlord-weekly-report/admin-send": [
        "./lib/shm/templates/landlord-weekly-report-template.pdf",
        "./public/shm-plugin-assets/templates/landlord-weekly-report-template.pdf",
        "./lib/shm/templates/landlord-weekly-report-template.docx",
        "./public/shm-plugin-assets/templates/landlord-weekly-report-template.docx",
      ],
      "/api/shm-docs/landlord-weekly-report/make-webhook": [
        "./lib/shm/templates/landlord-weekly-report-template.docx",
        "./public/shm-plugin-assets/templates/landlord-weekly-report-template.docx",
      ],
    },
  },
  async headers() {
    const noStore = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];
    const staticAssets = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ];
    return [
      { source: "/dashboard/:path*", headers: noStore },
      { source: "/sign-document", headers: noStore },
      { source: "/signing-frame", headers: noStore },
      { source: "/login", headers: noStore },
      { source: "/register", headers: noStore },
      { source: "/shm-plugin-assets/:path*", headers: staticAssets },
    ];
  },
  async rewrites() {
    // Hostinger currently 404s App Router handlers under /api/*; keep legacy
    // /api/shm-docs/* URLs working by serving the /shm-docs/* mirrors.
    return [
      {
        source: "/api/shm-docs/:path*",
        destination: "/shm-docs/:path*",
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        "docxtemplater",
        "pizzip",
        "@electric-sql/pglite",
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
