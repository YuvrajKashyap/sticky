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
    background_color: "#fff8df",
    theme_color: "#ffce3a",
    categories: ["productivity", "utilities"],
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
  };
}
