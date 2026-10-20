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

Другие команды:

```bash
npm test           # тесты слоя данных
npm run typecheck  # проверка типов
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

## AI-ассистент (Claude)

Правая панель — чат с Claude, который сам создаёт и закрывает задачи, пишет и правит заметки.

1. Создай API-ключ на [console.anthropic.com](https://console.anthropic.com) → API Keys.
2. Открой приложение, вставь ключ в панели ассистента и нажми «Сохранить». Ключ проверяется запросом к API и хранится зашифрованным через Electron `safeStorage` (связка ключей macOS) в `userData/anthropic-key.bin`; в renderer он не попадает.
3. Пиши или диктуй: «завтра позвонить в банк и купить продукты», «закрыл задачу про банк, договорились о лимите», «допиши в заметку Идеи …».

Модель по умолчанию Claude Opus 5.5, в настройках можно выбрать Sonnet 5.5 или Haiku 5.5 и глубину размышлений.

Код: `src/main/ai/` (агент, инструменты, хранение ключа, IPC `ai:*`), `src/shared/ai.ts`, `src/preload/ai.ts` (`window.api.ai`), `src/renderer/src/components/AssistantPanel.tsx`. Другие компоненты могут отправить текст ассистенту (например, из голосового ввода): `window.dispatchEvent(new CustomEvent('assistant:submit', { detail: 'текст' }))`.
