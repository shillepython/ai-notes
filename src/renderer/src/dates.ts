export const toISODate = (d: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const today = (): string => toISODate(new Date())

export const formatDue = (date: string | null): string => {
  if (!date) return ''
  const t = today()
  const tomorrow = toISODate(new Date(Date.now() + 86_400_000))
  if (date === t) return 'Сегодня'
  if (date === tomorrow) return 'Завтра'
  return new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export const addDays = (n: number): string => toISODate(new Date(Date.now() + n * 86_400_000))

/** Next Monday (or the one after, if today is Monday). */
export const nextWeek = (): string => {
  const d = new Date()
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  return toISODate(d)
}
