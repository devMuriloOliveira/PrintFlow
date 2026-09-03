<script setup lang="ts">
const { notify } = useUi()
const auth = useAuth()
const { members, loading: membersLoading, refreshMembers, updateMember } = useTenantMembers()

const active = ref('Empresa')
const savingMemberId = ref('')
const memberDrafts = reactive<Record<string, { role: string; status: string }>>({})
const tabs = [
  ['Empresa', 'building', 'Informacoes da empresa'],
  ['Financeiro', 'money', 'Impostos, moedas e contas'],
  ['Usuarios e Permissoes', 'users', 'Gestao de usuarios e acessos'],
  ['Notificacoes', 'bell', 'E-mails e alertas do sistema'],
  ['Seguranca', 'shield', 'Acesso, 2FA e sessoes'],
  ['Personalizacao', 'settings', 'Marca, aparencia e preferencias'],
  ['Integracoes', 'box', 'Marketplaces e servicos'],
  ['Backup e Dados', 'download', 'Exportar e restaurar dados']
]
const company = reactive({ name: '', cnpj: '', phone: '', email: '', address: '', district: '', city: '', state: '', zip: '', country: 'Brasil', currency: 'Real (R$)', timezone: '(GMT-03:00) Brasilia', kwh: 0 })
const roles = [
  { value: 'owner', label: 'Owner', description: 'Controle total do tenant, inclusive outros Owners.' },
  { value: 'admin', label: 'Administrador', description: 'Gerencia membros e a operacao, sem poderes reservados de Owner.' },
  { value: 'financeiro', label: 'Financeiro', description: 'Acessa vendas, despesas e informacoes financeiras.' },
  { value: 'producao', label: 'Producao', description: 'Gerencia producao, impressoras e catalogo.' },
  { value: 'usuario', label: 'Usuario', description: 'Acesso operacional basico.' }
]

const canManageMembers = computed(() => ['owner', 'admin'].includes(String(auth.user.value?.role || '')))
const roleCount = (role: string) => members.value.filter((member) => member.role === role).length
const memberBadge = (status: string) => status === 'active' ? 'badge badge--green' : 'badge badge--orange'
const memberStatusLabel = (status: string) => status === 'active' ? 'Ativo' : 'Suspenso'
const canEditMember = (member: { role: string }) => canManageMembers.value &&
  (auth.user.value?.role === 'owner' || member.role !== 'owner')

const syncMemberDrafts = () => {
  for (const member of members.value) {
    memberDrafts[member.userId] = { role: member.role, status: member.status }
  }
}

const loadMembers = async () => {
  try {
    await refreshMembers()
    syncMemberDrafts()
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel carregar os usuarios.')
  }
}

const saveMember = async (userId: string) => {
  const draft = memberDrafts[userId]
  if (!draft) return

  savingMemberId.value = userId
  try {
    await updateMember(userId, {
      role: draft.role as 'owner' | 'admin' | 'financeiro' | 'producao' | 'usuario',
      status: draft.status as 'active' | 'suspended'
    })
    notify('Acesso do usuario atualizado. As sessoes dele foram encerradas.')
  } catch (error: any) {
    notify(error?.data?.error || error?.message || 'Nao foi possivel atualizar o acesso.')
    await loadMembers()
  } finally {
    savingMemberId.value = ''
  }
}

watch(active, (tab) => {
  if (tab === 'Usuarios e Permissoes') void loadMembers()
})

watch(members, syncMemberDrafts, { immediate: true })
</script>

<template>
  <div>
    <PageHeader title="Configuracoes" subtitle="Gerencie as configuracoes da sua empresa e da plataforma" />

    <div class="settings-layout">
      <nav class="settings-nav">
        <button v-for="tab in tabs" :key="tab[0]" :class="{ active: active === tab[0] }" @click="active = tab[0]">
          <span class="settings-nav__icon"><UiIcon :name="tab[1]" /></span>
          <span><strong>{{ tab[0] }}</strong><small>{{ tab[2] }}</small></span>
        </button>
      </nav>

      <section class="settings-panel">
        <div v-if="active === 'Empresa'">
          <div style="display:flex;justify-content:space-between;gap:12px">
            <div><h2>Informacoes da Empresa</h2><p>Atualize os dados principais da sua empresa.</p></div>
            <button class="btn btn--primary" @click="notify('Alteracoes salvas com sucesso')">Salvar alteracoes</button>
          </div>
          <div class="form-grid">
            <div class="field col-7"><label>Nome da Empresa *</label><input v-model="company.name"></div><div class="field col-5"><label>CNPJ *</label><input v-model="company.cnpj"></div><div class="field col-6"><label>Telefone</label><input v-model="company.phone"></div><div class="field col-6"><label>E-mail *</label><input v-model="company.email"></div><div class="field col-8"><label>Endereco *</label><input v-model="company.address"></div><div class="field col-4"><label>Bairro</label><input v-model="company.district"></div><div class="field col-4"><label>Cidade *</label><input v-model="company.city"></div><div class="field col-2"><label>Estado *</label><input v-model="company.state"></div><div class="field col-3"><label>CEP *</label><input v-model="company.zip"></div><div class="field col-3"><label>Pais *</label><input v-model="company.country"></div><div class="field col-4"><label>Moeda</label><input v-model="company.currency"></div><div class="field col-4"><label>Fuso Horario</label><input v-model="company.timezone"></div><div class="field col-4"><label>Custo medio do kWh</label><input v-model.number="company.kwh" type="number" step=".01"></div><div class="field col-12"><label>Logotipo da Empresa</label><div class="info-note" style="align-items:center;justify-content:center;min-height:90px"><AppLogo /><span>Clique ou arraste o arquivo aqui</span></div></div>
          </div>
        </div>

        <div v-else-if="active === 'Usuarios e Permissoes'">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div><h2>Usuarios e Permissoes</h2><p>Altere o acesso de membros ja cadastrados neste tenant.</p></div>
            <button class="btn" :disabled="membersLoading" @click="loadMembers">Atualizar</button>
          </div>

          <div v-if="!canManageMembers" class="info-note"><UiIcon name="shield" />Somente Owner e Administrador podem gerenciar acessos.</div>
          <div v-else-if="membersLoading && !members.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" :size="29" /></div><h3>Carregando usuarios</h3><p>Consultando os membros autorizados deste tenant.</p></div></div>
          <div v-else-if="!members.length" class="empty-state"><div><div class="empty-state__icon"><UiIcon name="users" :size="29" /></div><h3>Nenhum usuario encontrado</h3><p>Convites de novos usuarios serao adicionados em uma proxima etapa segura.</p></div></div>
          <div v-else class="table-scroll" style="margin-top:16px">
            <table class="data-table">
              <thead><tr><th>Usuario</th><th>Perfil</th><th>Status</th><th>Acao</th></tr></thead>
              <tbody>
                <tr v-for="member in members" :key="member.userId">
                  <td><div class="table-product"><span class="avatar">{{ member.name.slice(0, 2).toUpperCase() }}</span><div><strong>{{ member.name }}</strong><small>{{ member.email }}</small></div></div></td>
                  <td><select v-model="memberDrafts[member.userId].role" class="select-compact" :disabled="!canEditMember(member)"><option v-for="role in roles" :key="role.value" :value="role.value">{{ role.label }}</option></select></td>
                  <td><select v-model="memberDrafts[member.userId].status" class="select-compact" :disabled="!canEditMember(member)"><option value="active">Ativo</option><option value="suspended">Suspenso</option></select><span :class="memberBadge(member.status)" style="margin-left:6px">{{ memberStatusLabel(member.status) }}</span></td>
                  <td><button class="btn btn--primary" :disabled="!canEditMember(member) || savingMemberId === member.userId" @click="saveMember(member.userId)">{{ savingMemberId === member.userId ? 'Salvando...' : 'Salvar' }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-else class="empty-state"><div><div class="empty-state__icon"><UiIcon :name="tabs.find((item) => item[0] === active)?.[1] || 'settings'" :size="29" /></div><h3>{{ active }}</h3><p>Este modulo visual esta preparado para receber as configuracoes correspondentes quando conectado a API.</p><button class="btn btn--primary" @click="notify('Preferencias atualizadas')">Salvar preferencias</button></div></div>
      </section>

      <aside class="settings-panel"><h2>LGPD e Isolamento de Dados</h2><p>Seus dados estao seguros e em conformidade com a legislacao.</p><ul class="check-list"><li><span><UiIcon name="check" :size="15" /></span>Seus dados sao armazenados com criptografia de ponta a ponta.</li><li><span><UiIcon name="check" :size="15" /></span>Backups diarios realizados em ambiente seguro.</li><li><span><UiIcon name="check" :size="15" /></span>Isolamento total entre contas e empresas.</li><li><span><UiIcon name="check" :size="15" /></span>Conformidade com a Lei Geral de Protecao de Dados.</li></ul><button class="btn btn--wide" @click="notify('Solicitacao de exportacao registrada')"><UiIcon name="download" />Solicitar exportacao dos dados</button></aside>
    </div>

    <PanelCard v-if="active === 'Usuarios e Permissoes'" title="Funcoes de Usuario" subtitle="Os acessos sao aplicados pelo backend e registrados em auditoria." style="margin-top:12px">
      <div class="role-grid"><div v-for="(role, index) in roles" :key="role.value" class="role-card"><div class="role-card__icon" :style="index === 1 ? { color: '#1768f2', background: '#eef5ff' } : index === 2 ? { color: '#0da566', background: '#eaf9f1' } : index === 3 ? { color: '#f57c1f', background: '#fff3e9' } : {}"><UiIcon :name="index === 0 ? 'shield' : index === 2 ? 'money' : index === 3 ? 'box' : 'users'" /></div><h3>{{ role.label }}</h3><p>{{ role.description }}</p><span class="badge">{{ roleCount(role.value) }} usuarios</span></div></div>
    </PanelCard>
  </div>
</template>
