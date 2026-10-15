// ============================================================================
// Site & Branding Default Configuration (site-config.ts)
//
// Default fallback metadata and branding for VistaBridge:
// - App title, descriptive tagline, and default logo path
// - Default theme colors (primary oceanic blue, slate secondary)
// ============================================================================

export type SiteConfig = {
  name: string;
  description: string;
  logo: string;
  colors: {
    primary: string;
    secondary: string;
  };
  font: string;
  api: {
    baseUrl: string;
  };
};

export const siteConfig: SiteConfig = {
  name: "VistaBridge",
  description: "Enterprise Spatial Data Infrastructure ( SDI ) solution",
  logo: "/vblogo.png", // Path in public directory
  colors: {
    primary: "#0284c7",   // Oceanic Web GIS Blue
    secondary: "#0f172a", // Dark Slate
  },
  font: "Inter",
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_URL || "/api",
  },
};
