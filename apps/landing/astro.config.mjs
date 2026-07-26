// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://vcontext.dev",

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),

  integrations: [
    sitemap({
      filter: (page) => !page.includes("/install."),
    }),
  ],
});