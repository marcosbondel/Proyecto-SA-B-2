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
   * `@artmizu/nuxt-prometheus` registers its own `GET /health` by default, and
   * its handler wins over `server/routes/health.get.ts` — so until T-21 this
   * application answered `ok` as two bytes of `text/html` while the six NestJS
   * images answered `{"status":"ok","application":"..."}` as JSON.
   *
   * One question should not have two answers in one system. The module's route
   * is turned off and this application's own handler serves it, in the shape
   * every other component uses, beside the `/ready` the module has no notion of.
   * `/metrics` is untouched: that is what this module is here for.
   */
  prometheus: {
    healthCheck: false
  },

  /**
   * The tab icon is the "bk" tile from the application header. The SVG keeps
   * it crisp at any size; the multi-size `.ico` beside it covers browsers
   * that do not take an SVG favicon.
   */
  app: {
    head: {
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '16x16 32x32 48x48' }
      ]
    }
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
