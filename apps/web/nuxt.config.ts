// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@artmizu/nuxt-prometheus'
  ],

  /**
   * Without this, Tailwind and Nuxt UI compile to nothing.
   *
   * Nuxt UI does not inject its own stylesheet: it expects an entry that
   * imports `tailwindcss` and `@nuxt/ui`, and the minimal starter this
   * application grew from had none. The symptom is not an error — the build
   * succeeds and serves a 1-byte stylesheet, so every component renders as
   * unstyled HTML.
   */
  css: ['~/assets/css/main.css'],

  /**
   * The semantic aliases have to be registered here before `app.config.ts` can
   * point them at a palette. Without this the module emits variables for
   * `neutral` alone, and every `color="primary"` on a component silently
   * resolves to nothing — which looks like a styling bug, not a config one.
   */
  ui: {
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral']
    }
  },

  /**
   * Light only. `docs/DESIGN.md` defines one palette and no dark counterpart,
   * so an automatic dark mode would be a design nobody approved — in the one
   * interface where a wrong contrast ratio makes a balance unreadable.
   */
  colorMode: {
    preference: 'light',
    fallback: 'light'
  },

  /**
   * The Gateway's address is read at runtime, never compiled in, so one build
   * serves development and the cluster alike. It is `public` because the
   * browser is what calls it — which is also why nothing secret may ever be
   * added under this key.
   */
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
    }
  }
})
