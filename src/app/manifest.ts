import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sticky",
    short_name: "Sticky",
    description: "Premium sticky tasks for fast capture, lists, subtasks, due dates, and recurrence.",
    id: "https://sticky.yuvrajkashyap.com/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    background_color: "#fff8df",
    theme_color: "#ffce3a",
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
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
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
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Today View",
        short_name: "Today",
        description: "Open Sticky filtered to stickies due today.",
        url: "/?view=today",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Scheduled View",
        short_name: "Scheduled",
        description: "Open Sticky filtered to scheduled stickies.",
        url: "/?view=scheduled",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Search Sticky",
        short_name: "Search",
        description: "Open Sticky with current-list search focused.",
        url: "/?intent=search",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    ],
  };
}
