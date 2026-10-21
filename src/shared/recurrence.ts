// Repeat rules for recurring tasks. Dates are local calendar days (YYYY-MM-DD).

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface Recurrence {
  freq: RepeatFreq
  /** Every N days/weeks/months/years; 1 by default */
  interval: number
  /** Weekly only: ISO weekdays 1 (Mon) … 7 (Sun). Empty = the weekday of the due date. */
  weekdays?: number[]
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const toISODate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const parse = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string): number => parse(date).getDay() || 7

const addDays = (date: string, n: number): string => {
  const d = parse(date)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** Adds months keeping the day of month, clamped to the month's end (31 Jan + 1 month = 28/29 Feb). */
const addMonths = (date: string, n: number, day: number): string => {
  const d = parse(date)
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return toISODate(target)
}

/** Cleans up a rule: interval ≥ 1, weekdays sorted and unique (weekly only). */
export function normalizeRecurrence(rule: Recurrence): Recurrence {
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  if (rule.freq !== 'weekly') return { freq: rule.freq, interval }
  const weekdays = [...new Set((rule.weekdays ?? []).filter((d) => d >= 1 && d <= 7))].sort()
  return weekdays.length ? { freq: 'weekly', interval, weekdays } : { freq: 'weekly', interval }
}

/** The occurrence right after `date`. `anchorDay` keeps the day of month for monthly/yearly rules. */
function step(rule: Recurrence, date: string, anchorDay: number): string {
  const n = Math.max(1, rule.interval || 1)
  switch (rule.freq) {
    case 'daily':
      return addDays(date, n)
    case 'monthly':
      return addMonths(date, n, anchorDay)
    case 'yearly':
      return addMonths(date, 12 * n, anchorDay)
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [isoWeekday(date)]
      const wd = isoWeekday(date)
      const later = days.find((d) => d > wd)
      if (later) return addDays(date, later - wd)
      // Jump to the first listed weekday of the week N weeks on.
      return addDays(date, 7 * n - (wd - days[0]))
    }
  }
}

/** The first occurrence on or after `from` (for a new task with no due date yet). */
export function firstOccurrence(rule: Recurrence, from: string): string {
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    const wd = isoWeekday(from)
    const d = rule.weekdays.find((x) => x >= wd) ?? rule.weekdays[0] + 7
    return addDays(from, d - wd)
  }
  return from
}

/**
 * The next due date after a task due on `due` is done: the first occurrence after
 * both `due` and `today`, so an overdue daily task does not come back in the past.
 */
export function nextOccurrence(rule: Recurrence, due: string, today: string): string {
  const anchorDay = parse(due).getDate()
  let next = step(rule, due, anchorDay)
  for (let i = 0; next <= today && i < 5000; i++) next = step(rule, next, anchorDay)
  return next
}

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
const WEEKDAYS_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье']

/** "каждый день", "по будням", "каждую пятницу", "по пн, ср", "каждые 2 недели", "каждый месяц". */
export function describeRecurrence(rule: Recurrence): string {
  const n = rule.interval || 1
  const days = rule.weekdays ?? []
  if (rule.freq === 'weekly' && days.length) {
    const list = days.join(',') === '1,2,3,4,5' ? 'по будням' : days.length === 1 ? null : `по ${days.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ')}`
    const single = days.length === 1 ? `${everyFem(days[0])} ${WEEKDAYS_ACC[days[0] - 1]}` : null
    const base = list ?? single!
    return n > 1 ? `${base}, раз в ${n} ${plural(n, 'неделю', 'недели', 'недель')}` : base
  }
  if (n === 1)
    return { daily: 'каждый день', weekly: 'каждую неделю', monthly: 'каждый месяц', yearly: 'каждый год' }[rule.freq]
  const unit = {
    daily: plural(n, 'день', 'дня', 'дней'),
    weekly: plural(n, 'неделю', 'недели', 'недель'),
    monthly: plural(n, 'месяц', 'месяца', 'месяцев'),
    yearly: plural(n, 'год', 'года', 'лет')
  }[rule.freq]
  return `раз в ${n} ${unit}`
}

// "каждый вторник", "каждую среду", "каждое воскресенье"
const everyFem = (d: number): string => (d === 7 ? 'каждое' : d === 3 || d === 5 || d === 6 ? 'каждую' : 'каждый')

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
