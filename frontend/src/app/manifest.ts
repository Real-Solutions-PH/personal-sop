import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unfurl",
    short_name: "Unfurl",
    description: "Your life dashboard — habits, tasks, fitness and money.",
    start_url: "/today",
    display: "standalone",
    background_color: "#0f0f14",
    theme_color: "#0f0f14",
    icons: [
      { src: "/assets/images/favicon.png", sizes: "any", type: "image/png" },
    ],
  }
}
