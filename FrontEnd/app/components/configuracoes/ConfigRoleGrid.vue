<script setup lang="ts">
type Role = { value: string; label: string; description: string; access: string[] }

const props = defineProps<{ roles: Role[]; members: Array<{ role?: string }> }>()
const roleCount = (role: string) => props.members.filter((member) => member.role === role).length
const iconFor = (index: number) => index === 0 ? 'shield' : index === 2 ? 'money' : index === 3 ? 'box' : 'users'
const styleFor = (index: number) => index === 1
  ? { color: '#1768f2', background: '#eef5ff' }
  : index === 2
    ? { color: '#0da566', background: '#eaf9f1' }
    : index === 3
      ? { color: '#f57c1f', background: '#fff3e9' }
      : {}
</script>

<template>
  <div class="role-grid">
    <div v-for="(role, index) in roles" :key="role.value" class="role-card">
      <div class="role-card__icon" :style="styleFor(index)"><UiIcon :name="iconFor(index)" /></div>
      <h3>{{ role.label }}</h3>
      <p>{{ role.description }}</p>
      <ul style="margin:10px 0;padding-left:16px;color:var(--muted);font-size:10px">
        <li v-for="access in role.access" :key="access">{{ access }}</li>
      </ul>
      <span class="badge">{{ roleCount(role.value) }} usuarios</span>
    </div>
  </div>
</template>
