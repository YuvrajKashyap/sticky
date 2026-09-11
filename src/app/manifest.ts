import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sticky",
    short_name: "Sticky",
    description: "Fast capture, focused planning, recurring work, reminders, and a connected task API.",
    id: "https://sticky.yuvrajkashyap.com/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    background_color: "#050d1a",
    theme_color: "#05070f",
    categories: ["productivity", "utilities", "business"],
    dir: "ltr",
    lang: "en-US",
    launch_handler: {
      client_mode: ["focus-existing", "navigate-existing"],
    },
    orientation: "any",
    prefer_related_applications: false,
    icons: [
      {
        src: "/brand/sticky-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/sticky-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/brand/sticky-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    screenshots: [
      {
        src: "/install-screenshot-wide",
        sizes: "1280x720",
        type: "image/png",
        form_factor: "wide",
        label: "Sticky desktop workspace with lists, filters, quick capture, and sticky details.",
      },
      {
        src: "/install-screenshot-narrow",
        sizes: "390x844",
        type: "image/png",
        form_factor: "narrow",
        label: "Sticky mobile workspace optimized for fast capture and today planning.",
      },
    ],
    shortcuts: [
      {
        name: "Quick Capture",
        short_name: "Capture",
        description: "Open Sticky with the quick capture tray focused.",
        url: "/?intent=capture",
        icons: [{ src: "/brand/sticky-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Today View",
        short_name: "Today",
        description: "Open Sticky filtered to stickies due today.",
        url: "/?view=today",
        icons: [{ src: "/brand/sticky-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Scheduled View",
        short_name: "Scheduled",
        description: "Open Sticky filtered to scheduled stickies.",
        url: "/?view=scheduled",
        icons: [{ src: "/brand/sticky-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Search Sticky",
        short_name: "Search",
        description: "Open Sticky with current-list search focused.",
        url: "/?intent=search",
        icons: [{ src: "/brand/sticky-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
