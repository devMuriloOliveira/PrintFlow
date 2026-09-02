export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  ssr: false,
  devtools: { enabled: false },
  nitro: { preset: 'static' },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'https://printflow-api-4y5l.onrender.com'
    }
  },
  css: ['~/assets/css/admin.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'pt-BR' },
      title: 'PrintFlow | Administracao da Plataforma',
      meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }]
    }
  }
})
