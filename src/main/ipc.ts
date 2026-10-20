import { BrowserWindow, ipcMain } from 'electron'
import type { Store } from './store'

/** Exposes the store to the renderer as `notes:*` / `tasks:*` / `topics:*` channels and broadcasts `data:changed`. */
export function registerIpc(store: Store): void {
  ipcMain.handle('notes:list', (_e, q) => store.listNotes(q))
  ipcMain.handle('notes:get', (_e, id) => store.getNote(id))
  ipcMain.handle('notes:create', (_e, input) => store.createNote(input))
  ipcMain.handle('notes:update', (_e, id, patch) => store.updateNote(id, patch))
  ipcMain.handle('notes:delete', (_e, id) => store.deleteNote(id))

  ipcMain.handle('tasks:list', (_e, q) => store.listTasks(q))
  ipcMain.handle('tasks:get', (_e, id) => store.getTask(id))
  ipcMain.handle('tasks:create', (_e, input) => store.createTask(input))
  ipcMain.handle('tasks:update', (_e, id, patch) => store.updateTask(id, patch))
  ipcMain.handle('tasks:complete', (_e, id, opts) => store.completeTask(id, opts))
  ipcMain.handle('tasks:reopen', (_e, id) => store.reopenTask(id))
  ipcMain.handle('tasks:delete', (_e, id) => store.deleteTask(id))

  ipcMain.handle('topics:list', () => store.listTopics())
  ipcMain.handle('topics:get', (_e, id) => store.getTopic(id))
  ipcMain.handle('topics:create', (_e, input) => store.createTopic(input))
  ipcMain.handle('topics:update', (_e, id, patch) => store.updateTopic(id, patch))
  ipcMain.handle('topics:delete', (_e, id) => store.deleteTopic(id))

  store.on('changed', (change) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('data:changed', change)
  })
}
