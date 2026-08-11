// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@artmizu/nuxt-prometheus',
    '@hypernym/nuxt-anime',
    '@i2d/nuxt-pdf-frame',
    '@jasy/nuxt'
  ]
})