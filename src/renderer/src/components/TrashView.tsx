import { useEffect, useState } from 'react'
import { trashItemId, type TrashItem } from '@shared/types'
import { Icon } from './Icon'
import { TopicMark } from './Sidebar'
import { toast } from './Toasts'
import { pluralTasks } from '../taskViews'

const KIND_LABEL: Record<TrashItem['kind'], string> = { note: 'Заметка', task: 'Задача', topic: 'Топик' }

const titleOf = (item: TrashItem): string =>
  (item.kind === 'note' ? item.note.title : item.kind === 'task' ? item.task.title : item.topic.name) || 'Без названия'

function deletedLabel(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return `сегодня в ${time}`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ` в ${time}`
}

/** Deleted notes, tasks and topics: restore them or erase for good. */
export default function TrashView({ items }: { items: TrashItem[] }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)

  // The "are you sure" state of "Очистить корзину" times out on its own.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])

  const restore = async (item: TrashItem): Promise<void> => {
    await window.api.trash.restore(item.kind, trashItemId(item))
    toast(`Восстановлено: ${titleOf(item)}`)
  }

  const erase = async (item: TrashItem): Promise<void> => {
    await window.api.trash.delete(item.kind, trashItemId(item))
    toast(`Удалено навсегда: ${titleOf(item)}`)
  }

  const empty = async (): Promise<void> => {
    if (!confirming) return setConfirming(true)
    setConfirming(false)
    const n = await window.api.trash.empty()
    toast(`Корзина очищена, удалено навсегда: ${n}`)
  }

  return (
    <div className="tasks view-enter">
      <header className="page-header">
        <h1>
          <Icon name="trash" size={26} className="view-icon view-icon--trash" />
          Корзина
        </h1>
        <div className="page-sub trash-sub">
          <span>Удалённое хранится здесь, пока его не удалят навсегда</span>
          {items.length > 0 && (
            <button className={`ghost-btn danger ${confirming ? 'confirm' : ''}`} onClick={empty}>
              <Icon name="trash" size={13} />
              {confirming ? `Удалить навсегда (${items.length})?` : 'Очистить корзину'}
            </button>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="trash" size={28} />
          </div>
          <div className="empty-title">Корзина пуста</div>
          <div className="empty-hint">Удалённые задачи, заметки и топики появятся здесь</div>
        </div>
      ) : (
        <div className="trash-list">
          {items.map((item) => (
            <div key={`${item.kind}-${trashItemId(item)}`} className="trash-item">
              <span className="trash-mark">
                {item.kind === 'topic' ? (
                  <TopicMark topic={item.topic} />
                ) : (
                  <Icon name={item.kind === 'note' ? 'file' : 'checkCircle'} size={15} />
                )}
              </span>
              <div className="trash-text">
                <div className="trash-title">{titleOf(item)}</div>
                <div className="trash-meta">
                  {KIND_LABEL[item.kind]}
                  {item.kind === 'topic' && item.taskCount > 0 && ` · ${pluralTasks(item.taskCount)} без топика`}
                  {' · удалено '}
                  {deletedLabel(item.deletedAt)}
                </div>
              </div>
              <div className="trash-actions">
                <button className="ghost-btn" title="Вернуть на место" onClick={() => void restore(item)}>
                  <Icon name="undo" size={13} /> Восстановить
                </button>
                <button className="icon-btn danger" title="Удалить навсегда" onClick={() => void erase(item)}>
                  <Icon name="x" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
