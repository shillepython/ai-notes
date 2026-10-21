import type { FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers'
import type { Embed } from './semanticIndex'

// Local multilingual embedding model (Russian and English), ~120 MB, downloaded once
// into the same models folder as the voice model. No API key and no network after that.
export const EMBED_MODEL = process.env.SEMANTIC_MODEL || 'Xenova/multilingual-e5-small'

export type EmbedderProgress = { status: string; progress?: number }

let loading: Promise<FeatureExtractionPipeline> | null = null

export function loadEmbedder(cacheDir: string, onProgress?: (p: EmbedderProgress) => void): Promise<FeatureExtractionPipeline> {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = cacheDir
      const extractor = await pipeline('feature-extraction', EMBED_MODEL, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p: ProgressInfo) =>
          onProgress?.({ status: p.status, progress: 'progress' in p ? p.progress : undefined })
      })
      return extractor as FeatureExtractionPipeline
    })()
    // Allow a retry (e.g. no network on first use) instead of caching the failure.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** e5 models expect "query: " / "passage: " prefixes. */
export function makeEmbed(cacheDir: string, onProgress?: (p: EmbedderProgress) => void): Embed {
  return async (texts, kind) => {
    if (!texts.length) return []
    const extractor = await loadEmbedder(cacheDir, onProgress)
    const out = await extractor(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: 'mean', normalize: true }
    )
    const [n, dim] = out.dims as [number, number]
    const data = out.data as Float32Array
    return Array.from({ length: n }, (_, i) => data.slice(i * dim, (i + 1) * dim))
  }
}
