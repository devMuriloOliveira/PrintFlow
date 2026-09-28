<script setup lang="ts">
import {
  fromBrazilianDateInputValue,
  maskBrazilianDateInput,
  toBrazilianDateInputValue,
  toDateInputValue
} from '~/composables/useDateInput'

const props = withDefaults(defineProps<{
  modelValue?: string | null
  id?: string
  name?: string
  min?: string
  max?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
  ariaLabel?: string
}>(), {
  modelValue: '',
  id: undefined,
  name: undefined,
  min: undefined,
  max: undefined,
  disabled: false,
  required: false,
  placeholder: 'DD/MM/AAAA',
  ariaLabel: 'Data'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
  blur: [event: FocusEvent]
}>()

const displayValue = ref(toBrazilianDateInputValue(props.modelValue))
const editing = ref(false)
const invalid = ref(false)

const normalizedValue = computed(() => toDateInputValue(props.modelValue))

watch(() => props.modelValue, (value) => {
  if (!editing.value) displayValue.value = toBrazilianDateInputValue(value)
})

const updateFromText = (event: Event) => {
  editing.value = true
  displayValue.value = maskBrazilianDateInput((event.target as HTMLInputElement).value)
  const isoDate = fromBrazilianDateInputValue(displayValue.value)
  invalid.value = displayValue.value.length === 10 && !isoDate
  emit('update:modelValue', isoDate)
}

const finishTextEditing = (event: FocusEvent) => {
  editing.value = false
  const isoDate = fromBrazilianDateInputValue(displayValue.value)
  invalid.value = Boolean(displayValue.value) && !isoDate
  emit('update:modelValue', isoDate)
  emit('change', isoDate)
  emit('blur', event)
}

const updateFromPicker = (event: Event) => {
  const isoDate = (event.target as HTMLInputElement).value
  editing.value = false
  invalid.value = false
  displayValue.value = toBrazilianDateInputValue(isoDate)
  emit('update:modelValue', isoDate)
  emit('change', isoDate)
}
</script>

<template>
  <div class="date-input" :class="{ 'date-input--disabled': disabled }">
    <input
      :id="id"
      class="date-input__text"
      type="text"
      :name="name"
      :value="displayValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :aria-label="ariaLabel"
      :aria-invalid="invalid || undefined"
      inputmode="numeric"
      maxlength="10"
      autocomplete="off"
      @focus="editing = true"
      @input="updateFromText"
      @blur="finishTextEditing"
    >
    <span class="date-input__picker" aria-hidden="true">
      <UiIcon name="calendar" :size="17" />
      <input
        class="date-input__native"
        type="date"
        tabindex="-1"
        :value="normalizedValue"
        :min="min"
        :max="max"
        :disabled="disabled"
        @input="updateFromPicker"
      >
    </span>
  </div>
</template>

<style scoped>
.date-input {
  position: relative;
  width: 100%;
}

.date-input__text {
  padding-right: 42px !important;
}

.date-input__picker {
  position: absolute;
  top: 50%;
  right: 1px;
  display: grid;
  width: 39px;
  height: calc(100% - 2px);
  place-items: center;
  overflow: hidden;
  color: var(--muted);
  transform: translateY(-50%);
  cursor: pointer;
}

.date-input__native {
  position: absolute !important;
  inset: 0;
  width: 100% !important;
  min-height: 0 !important;
  height: 100% !important;
  margin: 0;
  border: 0 !important;
  padding: 0 !important;
  opacity: 0;
  cursor: pointer;
}

.date-input--disabled .date-input__picker,
.date-input--disabled .date-input__native {
  cursor: not-allowed;
}
</style>
