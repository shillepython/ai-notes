import { AI_IMAGE_TYPES, type AiImage, type AiImageType } from '@shared/ai'

// Pictures for the assistant: pasted, dropped or picked files become small enough PNG/JPEG
// (or stay as they are when they already fit) and get a preview URL for the composer.

/** Longest side the models read in full detail; bigger pictures are scaled down. */
const MAX_EDGE = 2576
/** The API takes up to 5 MB per picture; stay below it. */
const MAX_BYTES = 3.75 * 1024 * 1024
export const MAX_IMAGES = 10

export interface PendingImage extends AiImage {
  id: string
  /** blob: URL; revoke it when the picture is dropped. */
  preview: string
}

/** Image files from a paste, drop or file input. */
export function imageFiles(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
}

const isApiType = (type: string): type is AiImageType => (AI_IMAGE_TYPES as readonly string[]).includes(type)

const withExt = (name: string, type: AiImageType): string => {
  const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]
  const base = (name || 'Картинка').replace(/\.[^.]+$/, '')
  return `${base}.${ext}`
}

async function encode(bitmap: ImageBitmap, scale: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Не удалось обработать картинку')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  // Screenshots stay sharp as PNG; photos that come out too heavy go to JPEG.
  const png = await canvas.convertToBlob({ type: 'image/png' })
  if (png.size <= MAX_BYTES) return png
  for (const quality of [0.9, 0.8, 0.7]) {
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    if (jpeg.size <= MAX_BYTES) return jpeg
  }
  throw new Error('Картинка слишком большая')
}

export async function prepareImage(file: File): Promise<PendingImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(`Не получилось открыть «${file.name || 'картинку'}»: формат не поддерживается`)
  }
  try {
    const edge = Math.max(bitmap.width, bitmap.height)
    const fits = isApiType(file.type) && edge <= MAX_EDGE && file.size <= MAX_BYTES
    const blob = fits ? file : await encode(bitmap, Math.min(1, MAX_EDGE / edge))
    const mediaType = blob.type as AiImageType
    return {
      id: crypto.randomUUID(),
      name: fits ? file.name || withExt('', mediaType) : withExt(file.name, mediaType),
      mediaType,
      data: new Uint8Array(await blob.arrayBuffer()),
      preview: URL.createObjectURL(blob)
    }
  } finally {
    bitmap.close()
  }
}

/** Prepares several files, keeping the ones that worked and reporting the first failure. */
export async function prepareImages(files: File[], room: number): Promise<{ images: PendingImage[]; error: string | null }> {
  const picked = files.slice(0, Math.max(0, room))
  const results = await Promise.allSettled(picked.map(prepareImage))
  const images = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  const error = failed
    ? failed.reason instanceof Error
      ? failed.reason.message
      : String(failed.reason)
    : files.length > picked.length
      ? `Можно приложить не больше ${MAX_IMAGES} картинок`
      : null
  return { images, error }
}

/** What goes over IPC: the bytes without the preview. */
export const toAiImages = (images: PendingImage[]): AiImage[] =>
  images.map(({ name, mediaType, data }) => ({ name, mediaType, data }))
