import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { marked } from 'marked'
import { AI_MODELS, type AiChatItem, type AiEffort, type AiModelId, type AiSettings } from '@shared/ai'
import { VoiceButton } from '@renderer/voice'
import { onUi } from '../hotkeys'
import { imageFiles, MAX_IMAGES, prepareImages, toAiImages, type PendingImage } from '../imageInput'
import { Icon, Kbd } from './Icon'
import { autosize } from './TaskBoard'
import './AssistantPanel.css'

const ai = (): typeof window.api.ai => window.api.ai

const EXAMPLES = [
  'Завтра нужно позвонить в банк, купить продукты и доделать презентацию к пятнице',
  'Я закрыл задачу про банк, договорились о новом лимите',
  'Что у меня сегодня?',
  'Итоги недели'
]

/**
 * Right-side assistant panel: chat with Claude that can create/close tasks and
 * edit notes. Pictures can be pasted (⌘V), dropped on the panel or picked, and go
 * along with the next message. Other components can submit text (e.g. from voice input) with
 * window.dispatchEvent(new CustomEvent('assistant:submit', { detail: 'текст' })).
 */
export default function AssistantPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [items, setItems] = useState<AiChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const currentRequest = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<PendingImage[]>([])
  const imagesRef = useRef(images)
  imagesRef.current = images
  const [imageError, setImageError] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    ai()
      .getSettings()
      .then((s) => {
        setSettings(s)
        if (!s.hasKey) setShowSettings(true)
      })
  }, [])

  useEffect(
    () =>
      ai().onEvent((event) => {
        if (event.requestId !== currentRequest.current) return
        if (event.type === 'item') setItems((prev) => [...prev, event.item])
        else {
          currentRequest.current = null
          setBusy(false)
        }
      }),
    []
  )

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, busy])

  useEffect(() => autosize(inputRef.current), [input])
  useEffect(() => onUi('assistant:focus', () => inputRef.current?.focus()), [])

  const addImages = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    const { images: ready, error } = await prepareImages(files, MAX_IMAGES - imagesRef.current.length)
    setImageError(error)
    if (ready.length) setImages((prev) => [...prev, ...ready])
    inputRef.current?.focus()
  }, [])

  const removeImage = (id: string): void => {
    setImages((prev) => {
      const gone = prev.find((img) => img.id === id)
      if (gone) URL.revokeObjectURL(gone.preview)
      return prev.filter((img) => img.id !== id)
    })
  }

  const submit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    // Pictures waiting in the composer go with whatever is sent next (typed, dictated or an example).
    const attached = imagesRef.current
    if (!trimmed && attached.length === 0) return
    setItems((prev) => [...prev, { kind: 'user', text: trimmed, images: attached.map((img) => img.preview) }])
    setInput('')
    setImages([])
    setImageError(null)
    setBusy(true)
    const requestId = crypto.randomUUID()
    currentRequest.current = requestId
    await ai().send(trimmed, requestId, toAiImages(attached))
  }, [])

  useEffect(() => {
    const onSubmit = (e: Event): void => {
      const text = (e as CustomEvent<string>).detail
      if (typeof text === 'string') void submit(text)
    }
    window.addEventListener('assistant:submit', onSubmit)
    return () => window.removeEventListener('assistant:submit', onSubmit)
  }, [submit])

  const onFormSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!busy) void submit(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!busy) void submit(input)
    }
  }

  const onPaste = (e: ClipboardEvent): void => {
    const files = imageFiles(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    void addImages(files)
  }

  const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current++
      setDropping(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (--dragDepth.current <= 0) {
        dragDepth.current = 0
        setDropping(false)
      }
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      const files = Array.from(e.dataTransfer.files)
      const pictures = imageFiles(files)
      if (pictures.length < files.length) setImageError('Ассистенту можно отправить только картинки')
      void addImages(pictures)
    }
  }

  const newChat = async (): Promise<void> => {
    await ai().resetConversation()
    currentRequest.current = null
    setBusy(false)
    for (const item of items) if (item.kind === 'user') item.images?.forEach((url) => URL.revokeObjectURL(url))
    setItems([])
  }

  if (!settings) return <div className="assistant" />

  if (showSettings || !settings.hasKey) {
    return (
      <div className="assistant">
        <AssistantSettings
          settings={settings}
          onChange={setSettings}
          onClose={settings.hasKey ? () => setShowSettings(false) : undefined}
        />
      </div>
    )
  }

  return (
    <div className={`assistant${dropping ? ' assistant--dropping' : ''}`} onPaste={onPaste} {...dropHandlers}>
      {dropping && (
        <div className="assistant__drop">
          <Icon name="image" size={22} />
          Отпусти, чтобы приложить картинку
        </div>
      )}
      <header className="assistant__header">
        <span className="assistant__title">
          <span className="assistant__logo">
            <Icon name="sparkles" size={14} />
          </span>
          Ассистент
          <span className="assistant__model">{AI_MODELS.find((m) => m.id === settings.model)?.label.split(' (')[0]}</span>
        </span>
        <button className="assistant__icon-btn" onClick={newChat} title="Новый диалог" disabled={items.length === 0 && !busy}>
          <Icon name="message" size={15} />
        </button>
        <button className="assistant__icon-btn" onClick={() => setShowSettings(true)} title="Настройки">
          <Icon name="settings" size={15} />
        </button>
        {onClose && (
          <button className="assistant__icon-btn" onClick={onClose} title="Скрыть (⌘.)">
            <Icon name="x" size={15} />
          </button>
        )}
      </header>

      <div className="assistant__list" ref={listRef}>
        {items.length === 0 && (
          <div className="assistant__empty">
            <div className="assistant__hero">
              <Icon name="sparkles" size={26} />
            </div>
            <h3>Чем помочь?</h3>
            <p>
              Надиктуй или напиши, что нужно сделать, или расскажи, что уже сделано. Я сам создам и закрою задачи. Можно
              вставить скриншот (⌘V) и попросить, что с ним сделать.
            </p>
            <div className="assistant__examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="assistant__example" onClick={() => submit(ex)} disabled={busy}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item, i) => (
          <ChatItem key={i} item={item} />
        ))}
        {busy && (
          <div className="assistant__thinking" aria-label="Думаю">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className="assistant__composer" onSubmit={onFormSubmit}>
        <div className="assistant__box">
          {images.length > 0 && (
            <div className="assistant__thumbs">
              {images.map((img) => (
                <div key={img.id} className="assistant__thumb" title={img.name}>
                  <img src={img.preview} alt={img.name} />
                  <button type="button" onClick={() => removeImage(img.id)} title="Убрать">
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              images.length
                ? 'Что сделать с картинкой? Например: создай задачи по этому скрину…'
                : 'Что нужно сделать? Например: завтра позвонить в банк и доделать презентацию к пятнице…'
            }
            rows={3}
          />
          {imageError && <div className="assistant__image-error">{imageError}</div>}
          <div className="assistant__box-bar">
            <button
              type="button"
              className="assistant__attach"
              onClick={() => fileRef.current?.click()}
              disabled={images.length >= MAX_IMAGES}
              title="Приложить картинку (или вставь ⌘V, перетащи)"
            >
              <Icon name="image" size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addImages(imageFiles(e.target.files))
                e.target.value = ''
              }}
            />
            <VoiceButton
              onTranscript={(text, source) =>
                source === 'hotkey' && !busy ? void submit(text) : setInput((v) => (v ? v + ' ' : '') + text)
              }
            />
            <span className="assistant__hint">
              <Kbd keys="enter" /> отправить · <Kbd keys="shift+enter" /> строка
            </span>
            {busy ? (
              <button type="button" className="assistant__send assistant__send--stop" onClick={() => ai().cancel()} title="Остановить">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="submit" className="assistant__send" disabled={!input.trim() && images.length === 0} title="Отправить (Enter)">
                <Icon name="arrowUp" size={16} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

function ChatItem({ item }: { item: AiChatItem }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <>
          {item.images?.length ? (
            <div className="assistant__msg-images">
              {item.images.map((url) => (
                <img key={url} src={url} alt="" />
              ))}
            </div>
          ) : null}
          {item.text && <div className="assistant__msg assistant__msg--user">{item.text}</div>}
        </>
      )
    case 'assistant':
      return <AssistantText text={item.text} />
    case 'action':
      return (
        <div className={`assistant__action ${item.ok ? '' : 'assistant__action--failed'}`}>
          <Icon name={item.ok ? 'check' : 'x'} size={12} /> {item.summary}
        </div>
      )
    case 'error':
      return <div className="assistant__error">{item.text}</div>
  }
}

function AssistantText({ text }: { text: string }): JSX.Element {
  const html = useMemo(() => marked.parse(text, { async: false, breaks: true }) as string, [text])
  return <div className="assistant__msg assistant__msg--assistant markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function AssistantSettings({
  settings,
  onChange,
  onClose
}: {
  settings: AiSettings
  onChange(s: AiSettings): void
  onClose?: () => void
}): JSX.Element {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const saveKey = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await ai().setKey(key)
    setSaving(false)
    if (!res.ok) return setError(res.error)
    setKey('')
    onChange(await ai().getSettings())
  }

  const removeKey = async (): Promise<void> => {
    await ai().clearKey()
    onChange(await ai().getSettings())
  }

  const update = async (patch: { model?: AiModelId; effort?: AiEffort }): Promise<void> => {
    onChange(await ai().updateSettings(patch))
  }

  return (
    <div className="assistant__settings">
      <header className="assistant__header">
        <span className="assistant__title">Настройки ассистента</span>
        {onClose && (
          <button className="assistant__icon-btn" onClick={onClose} title="Назад">
            <Icon name="x" size={15} />
          </button>
        )}
      </header>

      <section>
        <h4>API-ключ Anthropic</h4>
        {settings.hasKey ? (
          <p className="assistant__muted">
            Ключ сохранён (…{settings.keyHint}) в связке ключей macOS.{' '}
            <button className="assistant__link" onClick={removeKey}>
              Удалить
            </button>
          </p>
        ) : (
          <p className="assistant__muted">
            Создай ключ в console.anthropic.com → API Keys и вставь сюда. Он хранится зашифрованным и
            не покидает компьютер, кроме запросов к API Anthropic.
          </p>
        )}
        {!settings.encryptionAvailable && (
          <p className="assistant__error">Системное шифрование недоступно, ключ нельзя сохранить.</p>
        )}
        <form onSubmit={saveKey} className="assistant__key-form">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={settings.hasKey ? 'Заменить ключ: sk-ant-…' : 'sk-ant-…'}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={!key.trim() || saving || !settings.encryptionAvailable}>
            {saving ? 'Проверяю…' : 'Сохранить'}
          </button>
        </form>
        {error && <p className="assistant__error">{error}</p>}
      </section>

      <section>
        <h4>Модель</h4>
        <select value={settings.model} onChange={(e) => update({ model: e.target.value as AiModelId })}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h4>Глубина размышлений</h4>
        <select value={settings.effort} onChange={(e) => update({ effort: e.target.value as AiEffort })}>
          <option value="low">Быстро</option>
          <option value="medium">Обычно</option>
          <option value="high">Тщательно</option>
        </select>
      </section>
    </div>
  )
}
