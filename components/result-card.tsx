"use client"

import { FileText, Download } from "lucide-react"

export interface GrabResult {
  id: string
  title: string
  pages: number
  size: string
  platform: "slideshare" | "scribd"
}

export function ResultCard({ result }: { result: GrabResult }) {
  return (
    <section
      aria-label="Download result"
      className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-4"
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="rounded-md bg-primary/10 p-2 shrink-0">
          <FileText className="size-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground truncate text-balance">{result.title}</h3>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            {result.platform} · {result.pages} pages · {result.size}
          </p>
        </div>
      </div>
      <a
        href={`/api/file/${result.id}`}
        download
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity shrink-0"
      >
        <Download className="size-4" aria-hidden="true" />
        Download PDF
      </a>
    </section>
  )
}
