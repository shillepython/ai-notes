import type { Note, Task } from '@shared/types'
import { extractLinks, findBacklinks, linkTargetId, linkTargetTitle, resolveLink, type LinkTarget } from '@shared/links'
import { Icon } from './Icon'

/** What a [[link]] click asks the app to open: a known item, or a title to resolve (or create a note for). */
export type OpenLink = { kind: 'note' | 'task'; id: string } | { title: string }

/** Asks App to open a note or task (handled there, so any component can follow a link). */
export const openLink = (target: OpenLink): void => {
  window.dispatchEvent(new CustomEvent<OpenLink>('ui:open-link', { detail: target }))
}

const LinkChip = ({ target, missing }: { target: LinkTarget | null; missing?: string }): React.JSX.Element => (
  <button
    className={`chip link-chip ${target ? '' : 'missing'}`}
    title={target ? 'Открыть' : 'Такой заметки нет: создать'}
    onClick={() => openLink(target ? { kind: target.kind, id: linkTargetId(target) } : { title: missing! })}
  >
    <Icon name={target?.kind === 'task' ? 'checkCircle' : 'file'} size={12} />
    {target ? linkTargetTitle(target) || 'Без названия' : missing}
  </button>
)

/**
 * Outgoing [[links]] of a text and the backlinks to `title`, as clickable chips.
 * Renders nothing when there are neither, so it adds no clutter.
 */
export function LinksBlock({
  text,
  title,
  selfId,
  notes,
  tasks,
  layout
}: {
  text: string
  title: string
  selfId: string
  notes: Note[]
  tasks: Task[]
  layout: 'prop' | 'footer'
}): React.JSX.Element | null {
  const outgoing = extractLinks(text).map((t) => ({ title: t, target: resolveLink(t, notes, tasks) }))
  const backlinks = findBacklinks(title, notes, tasks, selfId)
  if (!outgoing.length && !backlinks.length) return null

  const rows = (
    <>
      {outgoing.length > 0 && (
        <div className="links-row">
          <span className="links-label">Ссылается на</span>
          <div className="chips">
            {outgoing.map((l) => (
              <LinkChip key={l.title} target={l.target} missing={l.title} />
            ))}
          </div>
        </div>
      )}
      {backlinks.length > 0 && (
        <div className="links-row">
          <span className="links-label">Ссылаются сюда</span>
          <div className="chips">
            {backlinks.map((b) => (
              <LinkChip key={linkTargetId(b)} target={b} />
            ))}
          </div>
        </div>
      )}
    </>
  )

  if (layout === 'footer')
    return (
      <section className="note-links">
        <h4>
          <Icon name="link" size={13} /> Связи
        </h4>
        {rows}
      </section>
    )
  return (
    <div className="prop prop--top">
      <span className="prop-label">Связи</span>
      <div className="links-stack">{rows}</div>
    </div>
  )
}
