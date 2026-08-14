export const useUi = () => {
  const toast = useState('global-toast', () => ({ visible: false, message: '', type: 'success' as 'success' | 'info' }))
  let timer: ReturnType<typeof setTimeout> | undefined

  const notify = (message: string, type: 'success' | 'info' = 'success') => {
    toast.value = { visible: true, message, type }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      toast.value.visible = false
    }, 2800)
  }

  return { toast, notify }
}
