/** A markdown file shown in the Documents section. */
export interface DocFile {
  path: string
  /** File name without .md */
  name: string
  /** First heading, or the name */
  title: string
  /** First sentence of the body (template cards, list) */
  excerpt: string
  /** ms */
  updatedAt: number
  size: number
  /** Opened from elsewhere on the Mac and edited in place */
  external: boolean
  /** Lives in the templates folder */
  template: boolean
}

export interface DocLibrary {
  docs: DocFile[]
  templates: DocFile[]
  /** ~/Documents/AI Notes */
  root: string
}
