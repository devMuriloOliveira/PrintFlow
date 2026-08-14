export type Order = {
  id: string; date: string; client: string; marketplace: string; product: string; qty: number;
  gross: number; fee: number; shipping: number; net: number; profit: number; status: string
}

export type Product = {
  name: string; subtitle: string; sku: string; category: string; price: number; weight: number;
  time: string; filament: string; filamentColor: string; cost: number; profit: number; margin: number;
  status: string; thumb: string
}

export const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
export const formatNumber = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

export const useAppData = () => {
  const products = useState<Product[]>('products', () => [
    { name: 'Vaso Geometrico', subtitle: 'Vaso decorativo moderno', sku: 'VGE-001', category: 'Decoracao', price: 49.9, weight: 212, time: '5h 20m', filament: 'PLA Cinza', filamentColor: '#5b6068', cost: 29, profit: 20.9, margin: 41.9, status: 'Ativo', thumb: 'vase' },
    { name: 'Suporte para Fone', subtitle: 'Suporte para headset', sku: 'SUP-002', category: 'Acessorios', price: 69.9, weight: 180, time: '3h 10m', filament: 'PLA Preto', filamentColor: '#16191e', cost: 21, profit: 48.9, margin: 70, status: 'Ativo', thumb: 'headphones' },
    { name: 'Flexi Dinossauro', subtitle: 'Brinquedo articulado', sku: 'DIN-003', category: 'Brinquedos', price: 59.9, weight: 95, time: '2h 45m', filament: 'PLA Verde', filamentColor: '#20a761', cost: 18, profit: 41.9, margin: 69.9, status: 'Ativo', thumb: 'dino' },
    { name: 'Porta Treco Modular', subtitle: 'Organizador multiuso', sku: 'PTM-004', category: 'Organizadores', price: 79.9, weight: 230, time: '6h 15m', filament: 'PLA Cinza', filamentColor: '#575d66', cost: 25, profit: 54.9, margin: 68.7, status: 'Ativo', thumb: 'organizer' },
    { name: 'Chaveiro Personalizado', subtitle: 'Chaveiro com nome', sku: 'CHV-005', category: 'Acessorios', price: 29.9, weight: 15, time: '40m', filament: 'PLA Marrom', filamentColor: '#85552f', cost: 9, profit: 20.9, margin: 69.9, status: 'Ativo', thumb: 'key' }
  ])

  const orders = useState<Order[]>('orders', () => [
    { id: '#10845', date: '31/05/2024', client: 'Marcos Silva', marketplace: 'Shopee', product: 'Vaso Geometrico', qty: 2, gross: 160, fee: 22.4, shipping: 18, net: 119, profit: 70.2, status: 'Novo' },
    { id: '#10844', date: '31/05/2024', client: 'Juliana Costa', marketplace: 'Mercado Livre', product: 'Suporte para Fone', qty: 1, gross: 89.9, fee: 13.49, shipping: 15, net: 61.41, profit: 35.1, status: 'Producao' },
    { id: '#10843', date: '30/05/2024', client: 'Rafael Almeida', marketplace: 'Elo7', product: 'Flexi Dinossauro', qty: 1, gross: 69.9, fee: 8.39, shipping: 12, net: 49.51, profit: 29.4, status: 'Impresso' },
    { id: '#10842', date: '30/05/2024', client: 'Camila Santos', marketplace: 'Shopee', product: 'Porta Treco Modular', qty: 2, gross: 120, fee: 16.8, shipping: 18, net: 85.2, profit: 51, status: 'Embalando' },
    { id: '#10841', date: '29/05/2024', client: 'Bruno Oliveira', marketplace: 'Mercado Livre', product: 'Chaveiro Personalizado', qty: 3, gross: 60, fee: 9, shipping: 10, net: 41, profit: 24.6, status: 'Enviado' },
    { id: '#10840', date: '29/05/2024', client: 'Fernanda Lima', marketplace: 'Amazon', product: 'Vaso Cachepot', qty: 1, gross: 99.9, fee: 14.99, shipping: 15, net: 69.91, profit: 39.8, status: 'Entregue' },
    { id: '#10839', date: '28/05/2024', client: 'Thiago Martins', marketplace: 'Instagram', product: 'Kit Miniaturas RPG', qty: 1, gross: 129.9, fee: 0, shipping: 20, net: 109.9, profit: 63.5, status: 'Entregue' },
    { id: '#10838', date: '27/05/2024', client: 'Larissa Pereira', marketplace: 'Elo7', product: 'Luminaria Lua 3D', qty: 1, gross: 149.9, fee: 17.99, shipping: 18, net: 113.91, profit: 65.3, status: 'Entregue' },
    { id: '#10837', date: '26/05/2024', client: 'Gustavo Nunes', marketplace: 'Shopee', product: 'Suporte para Controle', qty: 2, gross: 70, fee: 9.8, shipping: 15, net: 45.2, profit: 26.8, status: 'Cancelado' },
    { id: '#10836', date: '25/05/2024', client: 'Patricia Rocha', marketplace: 'Mercado Livre', product: 'Organizador de Mesa', qty: 1, gross: 59.9, fee: 8.99, shipping: 12, net: 38.91, profit: 22.1, status: 'Entregue' }
  ])

  const expenses = useState('expenses', () => [
    { description: 'Filamento PLA Preto 1kg', category: 'Filamento', supplier: '3D Fila', value: 480, date: '30/05/2024', payment: 'PIX', recurrence: 'Nao recorrente', status: 'Pago' },
    { description: 'Conta de Energia', category: 'Energia', supplier: 'Enel', value: 1180, date: '29/05/2024', payment: 'Boleto', recurrence: 'Recorrente', status: 'Pago' },
    { description: 'Caixa de Papelao 30x20x10', category: 'Embalagens', supplier: 'Pack & Box', value: 820, date: '28/05/2024', payment: 'PIX', recurrence: 'Nao recorrente', status: 'Pago' },
    { description: 'Impressora Creality Ender 3', category: 'Equipamentos', supplier: '3D Prime', value: 2750, date: '26/05/2024', payment: 'Cartao', recurrence: 'Nao recorrente', status: 'Pago' },
    { description: 'Manutencao Impressora', category: 'Manutencao', supplier: 'Tech 3D', value: 350, date: '24/05/2024', payment: 'PIX', recurrence: 'Nao recorrente', status: 'Pago' },
    { description: 'Assinatura Fusion 360', category: 'Software', supplier: 'Autodesk', value: 210, date: '24/05/2024', payment: 'Cartao', recurrence: 'Recorrente', status: 'Pago' },
    { description: 'Taxa Mercado Livre', category: 'Marketplace', supplier: 'Mercado Livre', value: 740, date: '23/05/2024', payment: 'Debito', recurrence: 'Recorrente', status: 'Pago' },
    { description: 'Anuncios Google Ads', category: 'Marketing', supplier: 'Google', value: 620, date: '21/05/2024', payment: 'Cartao', recurrence: 'Recorrente', status: 'Pago' },
    { description: 'Impostos Simples Nacional', category: 'Impostos', supplier: 'Receita Federal', value: 1250, date: '20/05/2024', payment: 'Boleto', recurrence: 'Recorrente', status: 'Pago' },
    { description: 'Frete Correios', category: 'Frete', supplier: 'Correios', value: 120, date: '18/05/2024', payment: 'PIX', recurrence: 'Nao recorrente', status: 'Pago' }
  ])

  const filaments = useState('filaments', () => [
    { name: 'PLA Preto', maker: 'eSUN', material: 'PLA', type: '1.75 mm', color: 'Preto', colorHex: '#111827', initial: 1000, remaining: 180, cost: 72, supplier: '3D Fila', date: '24/04/2024', status: 'Baixo estoque' },
    { name: 'PLA Branco', maker: 'Sunlu', material: 'PLA', type: '1.75 mm', color: 'Branco', colorHex: '#f3f4f6', initial: 1000, remaining: 620, cost: 65, supplier: '3D Fila', date: '15/04/2024', status: 'Em estoque' },
    { name: 'PETG Cinza', maker: 'eSUN', material: 'PETG', type: '1.75 mm', color: 'Cinza', colorHex: '#9ca3af', initial: 1000, remaining: 430, cost: 78, supplier: '3D Lab', date: '10/04/2024', status: 'Atencao' },
    { name: 'TPU Azul', maker: 'SainSmart', material: 'TPU', type: '1.75 mm', color: 'Azul', colorHex: '#1671e8', initial: 500, remaining: 260, cost: 85, supplier: '3D Lab', date: '05/04/2024', status: 'Atencao' },
    { name: 'ASA Preto', maker: 'eSUN', material: 'ASA', type: '1.75 mm', color: 'Preto', colorHex: '#111827', initial: 1000, remaining: 920, cost: 110, supplier: '3D Fila', date: '28/03/2024', status: 'Em estoque' }
  ])

  const printers = useState('printers', () => [
    { name: 'Ender 3 V2', code: 'PRT-001', maker: 'Creality', model: 'Ender 3 V2', acquired: '15/06/2022', power: 350, hours: 412, status: 'Em Impressao', maintenance: '28/04/2024', serial: 'CR-3V2-220615-001' },
    { name: 'Prusa i3 MK3', code: 'PRT-002', maker: 'Prusa Research', model: 'Prusa i3 MK3S+', acquired: '10/03/2022', power: 210, hours: 638, status: 'Disponivel', maintenance: '18/04/2024', serial: 'PR-MK3-220310-014' },
    { name: 'Bambu Lab P1P', code: 'PRT-003', maker: 'Bambu Lab', model: 'P1P', acquired: '22/11/2023', power: 350, hours: 156, status: 'Disponivel', maintenance: '10/05/2024', serial: 'BL-P1P-231122-092' },
    { name: 'Neptune 4', code: 'PRT-004', maker: 'Elegoo', model: 'Neptune 4', acquired: '05/01/2024', power: 500, hours: 189, status: 'Em Impressao', maintenance: '02/05/2024', serial: 'EL-N4-240105-031' },
    { name: 'Sermoon D3', code: 'PRT-005', maker: 'Creality', model: 'D3', acquired: '20/08/2023', power: 420, hours: 83, status: 'Em Manutencao', maintenance: '11/05/2024', serial: 'CR-D3-230820-066' },
    { name: 'Anycubic Kobra 2', code: 'PRT-006', maker: 'Anycubic', model: 'Kobra 2', acquired: '12/07/2023', power: 400, hours: 98, status: 'Disponivel', maintenance: '01/05/2024', serial: 'AC-K2-230712-055' }
  ])

  const marketplaces = useState('marketplaces', () => [
    { name: 'Shopee', short: 'S', color: '#ee4d2d', commission: 14, fixed: 2, financial: 4.49, ads: 3, others: 1, gross: 18450, net: 8250, orders: 284, active: true },
    { name: 'Mercado Livre', short: 'M', color: '#f9d616', commission: 16, fixed: 3.5, financial: 4.49, ads: 2, others: 1.2, gross: 13920, net: 6120, orders: 196, active: true },
    { name: 'Amazon', short: 'a', color: '#101820', commission: 17, fixed: 3.9, financial: 4.49, ads: 6, others: 1.5, gross: 9880, net: 3210, orders: 142, active: true },
    { name: 'Etsy', short: 'E', color: '#f1641e', commission: 6.5, fixed: 1, financial: 4.49, ads: 4, others: 1, gross: 4320, net: 2510, orders: 68, active: true },
    { name: 'TikTok Shop', short: '♪', color: '#111827', commission: 5, fixed: .5, financial: 4.49, ads: 5, others: 1, gross: 3940, net: 2120, orders: 73, active: true },
    { name: 'Site Proprio', short: '◎', color: '#1768f2', commission: 0, fixed: 0, financial: 2.99, ads: 0, others: .5, gross: 2980, net: 2720, orders: 51, active: true }
  ])

  const clients = useState('clients', () => [
    { name: 'Marcos Silva', email: 'marcos@email.com', phone: '(11) 98841-2201', orders: 14, revenue: 1890.4, ticket: 135.03, last: '31/05/2024' },
    { name: 'Juliana Costa', email: 'juliana@email.com', phone: '(11) 99432-6702', orders: 9, revenue: 1128.7, ticket: 125.41, last: '31/05/2024' },
    { name: 'Rafael Almeida', email: 'rafael@email.com', phone: '(19) 98118-3320', orders: 7, revenue: 840.5, ticket: 120.07, last: '30/05/2024' },
    { name: 'Camila Santos', email: 'camila@email.com', phone: '(11) 99654-1334', orders: 11, revenue: 1440, ticket: 130.91, last: '30/05/2024' },
    { name: 'Bruno Oliveira', email: 'bruno@email.com', phone: '(21) 99127-0495', orders: 5, revenue: 550.8, ticket: 110.16, last: '29/05/2024' }
  ])

  const expenseSegments = [
    { label: 'Filamento', value: 36.7, color: '#1768f2' }, { label: 'Marketplaces', value: 29.4, color: '#29b6c8' },
    { label: 'Embalagens', value: 8.8, color: '#f59e0b' }, { label: 'Energia', value: 12.7, color: '#fb923c' },
    { label: 'Marketing', value: 6.7, color: '#c83bb7' }, { label: 'Outros', value: 5.7, color: '#7d8799' }
  ]

  return { products, orders, expenses, filaments, printers, marketplaces, clients, expenseSegments }
}
