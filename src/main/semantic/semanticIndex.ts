import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Store } from '../store'
import type { SemanticHit } from '../../shared/types'

export type { SemanticHit }

// Search by meaning: notes and tasks are split into passages, each passage is
// turned into a vector by a local embedding model, and a query is matched by
// cosine similarity. Vectors live in their own SQLite file next to the main
// database, so the index can be dropped and rebuilt at any time.

/** Turns texts into L2-normalized vectors. 'query' and 'passage' may be embedded differently (e5 prefixes). */
export type Embed = (texts: string[], kind: 'query' | 'passage') => Promise<Float32Array[]>


interface Item {
  kind: 'note' | 'task'
  id: string
  title: string
  body: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS passages (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  hash TEXT NOT NULL,
  text TEXT NOT NULL,
  vec BLOB NOT NULL,
  PRIMARY KEY (kind, id, idx)
);
`

const MAX_PASSAGE = 700
const BATCH = 16

/** Splits a body into passages of up to MAX_PASSAGE chars on paragraph, then line, then sentence boundaries. */
export function splitPassages(title: string, body: string): string[] {
  const head = title.trim()
  const text = body.replace(/\r/g, '').trim()
  if (!text) return [head]
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((p) => (p.length <= MAX_PASSAGE ? [p] : p.split(/\n/)))
    .flatMap((p) => (p.length <= MAX_PASSAGE ? [p] : (p.match(/[^.!?]+[.!?]*\s*/g) ?? [p])))
  const out: string[] = []
  let cur = ''
  for (const piece of pieces) {
    const p = piece.trim()
    if (!p) continue
    if (cur && cur.length + p.length + 1 > MAX_PASSAGE) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n${p}` : p.slice(0, MAX_PASSAGE * 2)
  }
  if (cur) out.push(cur)
  // The title goes into every passage: it is often the strongest hint of what a passage is about.
  return out.map((p) => (head ? `${head}\n${p}` : p))
}

const hashOf = (item: Item): string => createHash('sha1').update(`${item.title}\u0000${item.body}`).digest('hex')

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
const fromBlob = (b: Uint8Array): Float32Array =>
  new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

export class SemanticIndex {
  private db: DatabaseSync
  private syncing: Promise<void> | null = null
  private dirty = false
  /** Decoded vectors, kept in memory between searches. Cleared on every sync that changes something. */
  private cache: { kind: 'note' | 'task'; id: string; text: string; vec: Float32Array }[] | null = null

  private store: Store
  private embed: Embed

  constructor(dbPath: string, store: Store, embed: Embed) {
    this.store = store
    this.embed = embed
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  /** True when something was indexed before (the model was downloaded once). */
  hasData(): boolean {
    return this.db.prepare('SELECT 1 FROM passages LIMIT 1').get() !== undefined
  }

  private items(): Item[] {
    return [
      ...this.store.listNotes().map((n) => ({ kind: 'note' as const, id: n.id, title: n.title, body: n.content })),
      ...this.store.listTasks().map((t) => ({ kind: 'task' as const, id: t.id, title: t.title, body: t.description }))
    ]
  }

  /** Brings the index in line with the store. Concurrent calls share one run; a call during a run schedules one more. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.dirty = true
      return this.syncing
    }
    this.syncing = (async () => {
      try {
        do {
          this.dirty = false
          await this.syncOnce()
        } while (this.dirty)
      } finally {
        this.syncing = null
      }
    })()
    return this.syncing
  }

  private async syncOnce(): Promise<void> {
    const known = new Map<string, string>()
    for (const r of this.db.prepare('SELECT kind, id, hash FROM passages WHERE idx = 0').all() as Record<string, string>[]) {
      known.set(`${r.kind}:${r.id}`, r.hash)
    }
    const items = this.items()
    const live = new Set(items.map((i) => `${i.kind}:${i.id}`))
    const remove = this.db.prepare('DELETE FROM passages WHERE kind = ? AND id = ?')
    let changed = false
    for (const key of known.keys()) {
      if (live.has(key)) continue
      const [kind, id] = key.split(':')
      remove.run(kind, id)
      changed = true
    }

    const todo = items.filter((i) => known.get(`${i.kind}:${i.id}`) !== hashOf(i))
    const insert = this.db.prepare('INSERT INTO passages (kind, id, idx, hash, text, vec) VALUES (?, ?, ?, ?, ?, ?)')
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      const passages = batch.flatMap((item) => splitPassages(item.title, item.body).map((text, idx) => ({ item, idx, text })))
      const vectors = await this.embed(passages.map((p) => p.text), 'passage')
      this.db.exec('BEGIN')
      try {
        for (const item of batch) remove.run(item.kind, item.id)
        passages.forEach((p, n) => insert.run(p.item.kind, p.item.id, p.idx, hashOf(p.item), p.text, toBlob(vectors[n])))
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
      changed = true
    }
    if (changed) this.cache = null
  }

  /** Best matches for a free-form query, most similar first. */
  async search(query: string, opts: { limit?: number; minScore?: number } = {}): Promise<SemanticHit[]> {
    const q = query.trim()
    if (!q) return []
    await this.sync()
    const [qv] = await this.embed([q], 'query')
    this.cache ??= (this.db.prepare('SELECT kind, id, text, vec FROM passages').all() as Record<string, unknown>[]).map((r) => ({
      kind: r.kind as 'note' | 'task',
      id: r.id as string,
      text: r.text as string,
      vec: fromBlob(r.vec as Uint8Array)
    }))
    const best = new Map<string, { kind: 'note' | 'task'; id: string; text: string; score: number }>()
    for (const p of this.cache) {
      const score = dot(qv, p.vec)
      const key = `${p.kind}:${p.id}`
      const prev = best.get(key)
      if (!prev || score > prev.score) best.set(key, { kind: p.kind, id: p.id, text: p.text, score })
    }
    const ranked = [...best.values()].sort((a, b) => b.score - a.score)
    const top = ranked[0]?.score ?? 0
    const minScore = opts.minScore ?? 0
    const hits: SemanticHit[] = []
    for (const r of ranked) {
      // Only what is about as close as the best hit: embedding scores are relative, not absolute.
      if (r.score < minScore || r.score < top - RELATIVE_WINDOW) break
      const title = r.kind === 'note' ? this.store.getNote(r.id)?.title : this.store.getTask(r.id)?.title
      if (title === undefined) continue
      const body = r.text.split('\n').slice(1).join(' ').trim()
      hits.push({ kind: r.kind, id: r.id, title: title || 'Без названия', snippet: body.slice(0, 160), score: Number(r.score.toFixed(3)) })
      if (hits.length >= (opts.limit ?? 8)) break
    }
    return hits
  }
}

/** How far below the best score a hit may be and still be shown. */
const RELATIVE_WINDOW = 0.05
