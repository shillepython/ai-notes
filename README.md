# AI Notes

Небольшое десктоп-приложение для macOS в духе Notion: заметки в markdown и планер задач,
которыми можно управлять через Claude (голосом или текстом).

Стек: Electron + electron-vite + React + TypeScript. Данные хранятся локально в SQLite
(встроенный `node:sqlite`, без нативных зависимостей) в файле
`~/Library/Application Support/ai-notes/ai-notes.db`.

## Запуск на macOS

Нужен Node.js 22+ (`brew install node`).

```bash
git clone git@github.com:shillepython/ai-notes.git
cd ai-notes
npm install
npm run dev        # запуск в режиме разработки
```

Если npm пропустил install-скрипты зависимостей, бинарник Electron докачается сам при
`npm install` или перед `npm run dev` (скрипт `scripts/ensure-electron.mjs`). Вручную:
`node node_modules/electron/install.js`.

## Установка как обычного приложения

Чтобы запускать AI Notes из Launchpad, Spotlight или Dock, а не из терминала, один раз
соберите и установите приложение (на самом Mac, Apple Silicon):

```bash
cd ai-notes
git pull && npm install
npm run install-app
```

Команда собирает `AI Notes.app` (arm64), закрывает запущенную копию, кладёт новую в
`/Applications` и открывает её. Дальше приложение запускается как любое другое: через
Spotlight (⌘ Space → «AI Notes») или из Dock (правый клик по иконке → Параметры →
Оставить в Dock). После обновления кода просто повторите `npm run install-app`.

**Gatekeeper.** Приложение подписано ad-hoc, без Apple Developer ID. Собранное локально
обычно открывается сразу. Если macOS всё же пишет, что не может проверить разработчика:
Системные настройки → Конфиденциальность и безопасность → внизу «AI Notes заблокировано»
→ «Всё равно открыть», затем подтвердите. Либо в терминале:
`xattr -dr com.apple.quarantine "/Applications/AI Notes.app"`.

**Что важно знать о собранной версии:**

- Данные общие с `npm run dev`: база, настройки и модель Whisper лежат в
  `~/Library/Application Support/ai-notes`, ничего переносить не нужно. Одновременно
  может работать только одна копия (dev или приложение), вторая просто активирует первую.
- API-ключ Anthropic шифруется через Связку ключей, а запись в ней привязана к самому
  приложению. Поэтому при первом запуске `AI Notes.app` ключ нужно ввести в настройках ещё
  раз (а `npm run dev` после этого попросит его снова). После переустановки macOS может
  спросить доступ к Связке ключей: нажмите
  «Разрешить всегда».
- При первом использовании голоса macOS спросит доступ к микрофону, а при первом
  напоминании — разрешение на уведомления. Их можно изменить в Системных настройках →
  Конфиденциальность и безопасность / Уведомления → AI Notes.

Другие команды:

```bash
npm test           # тесты слоя данных
npm run typecheck  # проверка типов
npm run pack:mac   # собрать AI Notes.app в dist/mac-arm64/ без установки
npm run dist:mac   # собрать .dmg в dist/
```

## Структура

```
src/
  main/            # процесс Electron (Node)
    index.ts       # окно приложения, инициализация
    store.ts       # слой данных: заметки и задачи (SQLite)
    ipc.ts         # каналы notes:* / tasks:* для интерфейса
  preload/         # window.api через contextBridge
  shared/types.ts  # общие типы Note, Task и т.д.
  renderer/        # интерфейс на React
```

## API данных

В main-процессе (например, для инструментов Claude):

```ts
import { getStore } from './store'

const store = getStore()
store.createTask({ title: 'Купить молоко', dueDate: '2026-10-21', priority: 'high' })
store.listTasks({ status: 'todo', dueTo: '2026-10-21' })
store.completeTask(id, { comment: 'Купил 2 литра' })
store.createNote({ title: 'Идеи', content: '# Markdown' })
store.listNotes({ query: 'идеи' })
```

| Заметки | Задачи |
| --- | --- |
| `listNotes({ query? })` | `listTasks({ status?, query?, dueFrom?, dueTo? })` |
| `getNote(id)` | `getTask(id)` |
| `createNote({ title, content? })` | `createTask({ title, description?, status?, priority?, dueDate? })` |
| `updateNote(id, patch)` | `updateTask(id, patch)` |
| `deleteNote(id)` | `completeTask(id, { comment? })`, `reopenTask(id)` |
| | `deleteTask(id)` |

После любого изменения стор генерирует событие `changed`, а main рассылает `data:changed` в окно,
поэтому интерфейс обновляется сам, даже если изменение сделал AI.

В renderer то же самое доступно как `window.api.notes.*`, `window.api.tasks.*` и
`window.api.onDataChanged(cb)`.

## Голосовой ввод

Распознавание речи работает локально (Whisper через `@huggingface/transformers` + onnxruntime),
без отдельных ключей и интернета. При первом запуске модель (~250 МБ) скачивается в
`~/Library/Application Support/ai-notes/models`, дальше всё офлайн.

- Кнопка с микрофоном: нажать, говорить, нажать ещё раз. `Esc` отменяет запись.
- Глобальная горячая клавиша `⌘⇧Space` из любого приложения: окно выходит на передний план
  и начинается запись, повторное нажатие останавливает и распознаёт.
- При первой записи macOS спросит доступ к микрофону.

Настройки через переменные окружения (для `npm run dev`):

| Переменная | По умолчанию | |
| --- | --- | --- |
| `VOICE_MODEL` | `onnx-community/whisper-small` | `onnx-community/whisper-large-v3-turbo` точнее, но в ~3 раза больше |
| `VOICE_LANGUAGE` | `russian` | язык распознавания |
| `VOICE_SHORTCUT` | `CommandOrControl+Shift+Space` | формат Electron accelerator |

Подключение в интерфейсе:

```tsx
import { VoiceButton } from '@renderer/voice'

<VoiceButton onTranscript={(text, source) => sendToClaude(text)} />
```

`source` равен `'hotkey'` или `'button'`. Есть и хук `useVoiceInput({ onTranscript })` для своей кнопки.

## AI-ассистент (Claude)

Правая панель — чат с Claude, который сам создаёт и закрывает задачи, пишет и правит заметки.

1. Создай API-ключ на [console.anthropic.com](https://console.anthropic.com) → API Keys.
2. Открой приложение, вставь ключ в панели ассистента и нажми «Сохранить». Ключ проверяется запросом к API и хранится зашифрованным через Electron `safeStorage` (связка ключей macOS) в `userData/anthropic-key.bin`; в renderer он не попадает.
3. Пиши или диктуй: «завтра позвонить в банк и купить продукты», «закрыл задачу про банк, договорились о лимите», «допиши в заметку Идеи …».

Модель по умолчанию Claude Opus 5.5, в настройках можно выбрать Sonnet 5.5 или Haiku 5.5 и глубину размышлений.

Код: `src/main/ai/` (агент, инструменты, хранение ключа, IPC `ai:*`), `src/shared/ai.ts`, `src/preload/ai.ts` (`window.api.ai`), `src/renderer/src/components/AssistantPanel.tsx`. Другие компоненты могут отправить текст ассистенту (например, из голосового ввода): `window.dispatchEvent(new CustomEvent('assistant:submit', { detail: 'текст' }))`.
