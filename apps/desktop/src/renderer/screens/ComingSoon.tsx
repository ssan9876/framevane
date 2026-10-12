import { ArrowLeft, Construction } from 'lucide-react'
import { Button, EmptyState } from '@reel/ui'
import { useApp } from '../app/store'

/** Stub for screens in the inventory that are not built yet (keeps every route reachable and honest about it). */
export function ComingSoon({ id, title, body, milestone }: { id: string; title: string; body: string; milestone: string }) {
  const go = useApp((s) => s.go)
  return (
    <main className="flex flex-1 flex-col">
      <header className="flex h-[var(--reel-titlebar-h)] items-center gap-2 border-b border-border bg-surface px-3">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={() => go({ name: 'home' })}>Projects</Button>
        <h1 className="text-base">{title}</h1>
      </header>
      <EmptyState className="flex-1" icon={<Construction />} title={`${title} isn't built yet`} body={`${body} (${id}, planned for ${milestone}.)`} action={<Button onClick={() => go({ name: 'home' })}>Back to projects</Button>} />
    </main>
  )
}
