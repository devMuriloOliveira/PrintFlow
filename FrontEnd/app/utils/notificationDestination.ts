// Only known notification types may choose a route; notification data is never a URL.
const destinations: Record<string, string> = {
  'print.started': '/impressoras',
  'print.start_timeout': '/impressoras',
  'agent.offline': '/impressoras',
  'agent.command_failed': '/impressoras',
  'production.printer_missing': '/produtos',
  'marketplace.sync_failed': '/marketplaces',
  'marketplace.sale_received': '/marketplaces?secao=pedidos',
  'marketplace.product_link_missing': '/marketplaces',
  'order.embalando': '/vendas',
  'order.entregue': '/vendas',
  'inventory.order_without_product': '/vendas',
  'inventory.filament_low_stock': '/filamentos',
  'inventory.product_out_of_stock': '/estoque',
  'inventory.production_recipe_missing': '/estoque',
  'inventory.production_consumption_pending': '/estoque',
  'subscription.status_changed': '/configuracoes/assinatura',
  'subscription.deadline_soon': '/configuracoes/assinatura',
  'privacy.request': '/configuracoes/privacidade'
}

export function notificationDestination(type: string): string | null {
  return Object.hasOwn(destinations, type) ? destinations[type]! : null
}
