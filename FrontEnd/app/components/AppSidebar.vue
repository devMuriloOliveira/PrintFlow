<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { settings } = useAppData()
const route = useRoute()
const expandedItems = reactive<Record<string, boolean>>({ Relatórios: route.path === '/relatorios', Marketplaces: route.path === '/marketplaces', Configurações: route.path.startsWith('/configuracoes/') })
const preferences = computed(() => (settings.value?.preferences as Record<string, unknown> | undefined) || {})
const brandName = computed(() => String(preferences.value.brandName || settings.value?.name || 'PrintFlow 3D'))
const childIsActive = (to: string) => {
  const [path, queryString] = to.split('?')
  if (route.path !== path) return false
  const section = new URLSearchParams(queryString || '').get('secao')
  return section ? String(route.query.secao || '') === section : true
}

const sections = [
  {
    label: 'PRINCIPAL',
    items: [
      { label: 'Dashboard', to: '/', icon: 'home' },
      { label: 'Vendas', to: '/vendas', icon: 'cart' },
      { label: 'Produtos', to: '/produtos', icon: 'box' },
      { label: 'Clientes', to: '/clientes', icon: 'users' }
    ]
  },
  {
    label: 'CANAIS DE VENDA',
    items: [
      { label: 'Marketplaces', to: '/marketplaces?secao=canais', icon: 'store', children: [{ label: 'Canais e taxas', to: '/marketplaces?secao=canais' }, { label: 'Conexões', to: '/marketplaces?secao=conexoes' }, { label: 'Pedidos sincronizados', to: '/marketplaces?secao=pedidos' }] }
    ]
  },
  {
    label: 'PRODUÇÃO',
    items: [
      { label: 'Calculadora 3D', to: '/calculadora-3d', icon: 'calculator' },
      { label: 'Filamentos', to: '/filamentos', icon: 'spool' },
      { label: 'Impressoras', to: '/impressoras', icon: 'printer' }
    ]
  },
  {
    label: 'FINANCEIRO',
    items: [
      { label: 'Despesas', to: '/despesas', icon: 'receipt' }
    ]
  },
  {
    label: 'ANÁLISES',
    items: [
      { label: 'Relatórios', to: '/relatorios?secao=financeiro', icon: 'chart', children: [{ label: 'Financeiro', to: '/relatorios?secao=financeiro' }, { label: 'Produtos e vendas', to: '/relatorios?secao=produtos' }, { label: 'Histórico financeiro', to: '/relatorios?secao=historico' }] },
      { label: 'Metas', to: '/metas', icon: 'target' }
    ]
  },
  {
    label: 'SISTEMA',
    items: [
      { label: 'Configurações', to: '/configuracoes', icon: 'settings', children: [{ label: 'Usuários e permissões', to: '/configuracoes/usuarios' }, { label: 'Segurança', to: '/configuracoes/seguranca' }, { label: 'Integrações', to: '/configuracoes/integracoes' }, { label: 'Backup e dados', to: '/configuracoes/backup' }, { label: 'Privacidade e LGPD', to: '/configuracoes/privacidade' }, { label: 'Ajuda e suporte', to: '/configuracoes/suporte' }] }
    ]
  }
]

watch(() => route.path, path => { if (path === '/relatorios') expandedItems['Relatórios'] = true; if (path === '/marketplaces') expandedItems.Marketplaces = true; if (path.startsWith('/configuracoes/')) expandedItems.Configurações = true })
</script>

<template>
  <div v-if="open" class="sidebar-backdrop" @click="emit('close')" />

  <aside class="sidebar" :class="{ 'sidebar--open': open }">
    <div class="sidebar__top">
      <AppLogo :logo-url="String(preferences.logoUrl || '')" :brand-name="brandName" />

      <button class="icon-btn sidebar__close" aria-label="Fechar menu" @click="emit('close')">
        <UiIcon name="close" />
      </button>
    </div>

    <nav class="sidebar__nav">
      <div v-for="section in sections" :key="section.label" class="nav-section">
        <span class="nav-section__title">{{ section.label }}</span>

        <div v-for="item in section.items" :key="item.to" class="nav-item-group">
          <NuxtLink
            :to="item.to"
            v-slot="{ href, navigate, isActive, isExactActive }"
            custom
          >
          <a
            :href="href"
            class="nav-item"
            :class="{
              'nav-item--active': item.to === '/' ? isExactActive : isActive
            }"
            @click="
              event => {
                navigate(event)
                if (item.children) expandedItems[item.label] = !expandedItems[item.label]
                else emit('close')
              }
            "
          >
            <UiIcon :name="item.icon" :size="20" />
            <span>{{ item.label }}</span>
            <span v-if="item.children" class="nav-item__chevron" :class="{ 'nav-item__chevron--open': expandedItems[item.label] }" aria-hidden="true">⌄</span>
          </a>
          </NuxtLink>
          <div v-if="item.children && expandedItems[item.label]" class="nav-submenu">
            <NuxtLink v-for="child in item.children" :key="child.to" :to="child.to" class="nav-submenu__item" :class="{ 'nav-submenu__item--active': childIsActive(child.to) }" @click="emit('close')">{{ child.label }}</NuxtLink>
          </div>
        </div>
      </div>
    </nav>

    <div class="tip-card">
      <div class="tip-card__icon">
        <UiIcon name="box" :size="21" />
      </div>

      <div>
        <strong>Dica PrintFlow</strong>
        <p>Transforme seus números em decisões mais seguras.</p>
        <NuxtLink to="/calculadora-3d">Saiba mais <span>→</span></NuxtLink>
      </div>
    </div>
  </aside>
</template>
