import { useState } from 'react'
import type { DocFile, DocLibrary } from '@shared/docs'
import { ago, isMarkdownFile, shortDir } from '../docs'
import { Icon } from './Icon'
import { toast } from './Toasts'

interface Props {
  library: DocLibrary
  onOpen: (path: string) => void
}

const errText = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)

const TEMPLATE_ICONS: [RegExp, string][] = [
  [/ceo|разговор|интервью/i, '💬'],
  [/встреч|созвон|meeting/i, '🤝'],
  [/проект|план|roadmap/i, '🗺️'],
  [/дневник|journal/i, '📔'],
  [/отчёт|отчет|report/i, '📊'],
  [/бриф|brief|тз|spec/i, '📋']
]
const templateIcon = (t: DocFile): string => TEMPLATE_ICONS.find(([re]) => re.test(`${t.name} ${t.title}`))?.[1] ?? '📄'

/** Markdown documents and templates: make a document from a template, open any .md, upload templates. */
export default function DocsHome({ library, onOpen }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [drop, setDrop] = useState<null | 'docs' | 'templates'>(null)
  const { docs, templates } = library

  const run = (fn: () => Promise<void>) => async (): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      toast(`Не получилось: ${errText(err)}`)
    }
  }

  const fromTemplate = (t: DocFile): Promise<void> =>
    run(async () => {
      const doc = await window.api.docs.create({ fromTemplate: t.path })
      onOpen(doc.path)
    })()

  const newDoc = run(async () => {
    const doc = await window.api.docs.create({ name: 'Новый документ', content: '# \n\n' })
    onOpen(doc.path)
  })

  const newTemplate = run(async () => {
    const doc = await window.api.docs.create({
      name: 'Новый шаблон',
      template: true,
      content: '# Название\n\nПодсказка, как заполнять.\n\n| Поле | Значение |\n|---|---|\n| Дата | {{date}} |\n| | |\n\n## Раздел\nВопрос:\n\n- [ ] пункт\n'
    })
    onOpen(doc.path)
  })

  const openFile = run(async () => {
    const paths = await window.api.docs.open()
    if (paths.length) onOpen(paths[0])
  })

  const uploadTemplates = run(async () => {
    const added = await window.api.docs.importTemplates()
    if (added.length) toast(added.length === 1 ? `Шаблон «${added[0].name}» загружен` : `Загружено шаблонов: ${added.length}`)
  })

  const remove = (d: DocFile): Promise<void> =>
    run(async () => {
      const res = await window.api.docs.remove(d.path)
      toast(res === 'trashed' ? `«${d.name}» в Корзине macOS` : `«${d.name}» убран из списка`)
    })()

  const download = (d: DocFile): Promise<void> =>
    run(async () => {
      const res = await window.api.docs.export(await window.api.docs.read(d.path), d.name)
      if (res) toast(`Сохранено: ${res.replace(/^.*\//, '')}`, { label: 'Показать', run: () => void window.api.docs.reveal(res) })
    })()

  const dropProps = (target: 'docs' | 'templates') => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      setDrop(target)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDrop(null)
      const files = Array.from(e.dataTransfer.files).filter(isMarkdownFile)
      if (!files.length) return toast('Нужен файл .md')
      if (target === 'templates')
        void run(async () => {
          const added = await window.api.docs.importTemplates(files)
          toast(added.length === 1 ? `Шаблон «${added[0].name}» загружен` : `Загружено шаблонов: ${added.length}`)
        })()
      else
        void run(async () => {
          const opened = await window.api.docs.openFiles(files)
          if (opened.length) onOpen(opened[0])
        })()
    }
  })

  const q = query.trim().toLowerCase()
  const shown = q ? docs.filter((d) => `${d.name} ${d.title} ${d.excerpt}`.toLowerCase().includes(q)) : docs

  return (
    <div className={`docs-home view-enter ${drop === 'docs' ? 'dropping' : ''}`} {...dropProps('docs')}>
      <header className="page-header">
        <h1>
          <Icon name="book" size={26} className="view-icon docs-icon" />
          Документы
        </h1>
        <div className="page-sub docs-sub">
          <span>
            Markdown-файлы в{' '}
            <button className="docs-path" onClick={() => void window.api.docs.reveal()} title="Открыть в Finder">
              ~/Documents/AI Notes
            </button>
          </span>
          <span className="docs-actions">
            <button className="ghost-btn" onClick={openFile} title="Открыть .md с диска, правки сохраняются в этот же файл">
              <Icon name="folder" size={13} /> Открыть .md…
            </button>
            <button className="primary-btn" onClick={newDoc}>
              <Icon name="plus" size={13} /> Новый документ
            </button>
          </span>
        </div>
      </header>

      <section className={`docs-section ${drop === 'templates' ? 'dropping' : ''}`} {...dropProps('templates')}>
        <div className="docs-section-head">
          <h2>Создать из шаблона</h2>
          <button className="ghost-btn" onClick={newTemplate}>
            <Icon name="pencil" size={12} /> Новый шаблон
          </button>
        </div>
        <div className="tpl-grid">
          {templates.map((t) => (
            <div key={t.path} className="tpl-card" role="button" tabIndex={0} onClick={() => void fromTemplate(t)}
              onKeyDown={(e) => e.key === 'Enter' && void fromTemplate(t)}
              title={`Новый документ из «${t.name}»`}
            >
              <span className="tpl-icon" aria-hidden>
                {templateIcon(t)}
              </span>
              <span className="tpl-name">{t.name}</span>
              {t.excerpt && <span className="tpl-excerpt">{t.excerpt}</span>}
              <span className="tpl-cta">
                <Icon name="plus" size={12} /> Заполнить
              </span>
              <span className="tpl-tools" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" title="Изменить шаблон" onClick={() => onOpen(t.path)}>
                  <Icon name="pencil" size={13} />
                </button>
                <button className="icon-btn" title="Скачать шаблон" onClick={() => void download(t)}>
                  <Icon name="download" size={13} />
                </button>
                <button className="icon-btn danger" title="Удалить шаблон" onClick={() => void remove(t)}>
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </div>
          ))}
          <button className="tpl-card tpl-upload" onClick={uploadTemplates}>
            <span className="tpl-icon" aria-hidden>
              <Icon name="upload" size={18} />
            </span>
            <span className="tpl-name">Загрузить шаблон</span>
            <span className="tpl-excerpt">Выбери .md или перетащи файлы сюда</span>
          </button>
        </div>
      </section>

      <section className="docs-section">
        <div className="docs-section-head">
          <h2>Мои документы</h2>
          {docs.length > 5 && (
            <label className="docs-search">
              <Icon name="search" size={13} />
              <input value={query} placeholder="Найти" onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
        </div>
        {docs.length === 0 ? (
          <div className="docs-empty">
            Здесь будут документы. Выбери шаблон выше, создай пустой или перетащи сюда свой .md
          </div>
        ) : (
          <div className="docs-list">
            {shown.map((d) => (
              <div key={d.path} className="doc-row" role="button" tabIndex={0} onClick={() => onOpen(d.path)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(d.path)}
              >
                <Icon name="file" className="muted-icon" />
                <div className="doc-row-text">
                  <div className="doc-row-title">{d.title || d.name}</div>
                  <div className="doc-row-meta">
                    {d.title !== d.name && <span>{d.name}.md</span>}
                    <span>{ago(d.updatedAt)}</span>
                    {d.external && (
                      <span className="doc-row-place" title={d.path}>
                        <Icon name="folder" size={11} /> {shortDir(d.path)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="doc-row-tools" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" title="Скачать .md" onClick={() => void download(d)}>
                    <Icon name="download" size={14} />
                  </button>
                  <button className="icon-btn" title="Показать в Finder" onClick={() => void window.api.docs.reveal(d.path)}>
                    <Icon name="folder" size={14} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title={d.external ? 'Убрать из списка (файл останется)' : 'Удалить в Корзину'}
                    onClick={() => void remove(d)}
                  >
                    <Icon name={d.external ? 'x' : 'trash'} size={14} />
                  </button>
                </span>
              </div>
            ))}
            {shown.length === 0 && <div className="docs-empty">Ничего не нашлось</div>}
          </div>
        )}
      </section>

      {drop && (
        <div className="drop-hint docs-drop">
          <Icon name={drop === 'templates' ? 'template' : 'file'} size={18} />
          {drop === 'templates' ? 'Отпусти, чтобы загрузить как шаблон' : 'Отпусти, чтобы открыть'}
        </div>
      )}
    </div>
  )
}
