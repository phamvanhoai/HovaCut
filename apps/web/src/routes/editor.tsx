import { createFileRoute } from '@tanstack/react-router'
import { Download, FileAudio, Film, GripVertical, Mic2, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import {
  createSegment,
  DEFAULT_VOICES,
  formatTime,
  projectDuration,
  toCsv,
  toVoiceList,
  type VoiceProject,
  type VoiceSegment,
} from '#/features/voice-script/model.ts'

export const Route = createFileRoute('/editor')({ component: Editor })

const STORAGE_KEY = 'hova-media.voice-project.v1'
const initialSegments: VoiceSegment[] = [
  createSegment(undefined, { id: 'welcome-1', text: 'Xin chào, đây là dự án video đầu tiên của bạn.', voiceName: 'Hoài My', durationMs: 3400 }),
  createSegment(undefined, { id: 'welcome-2', text: 'Thêm lời thoại, chọn giọng đọc và xuất danh sách khi hoàn tất.', voiceName: 'Nam Minh', startMs: 3400, durationMs: 4200 }),
]

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function Editor() {
  const [title, setTitle] = useState('Hova Media Project')
  const [segments, setSegments] = useState<VoiceSegment[]>(initialSegments)
  const [selectedId, setSelectedId] = useState(initialSegments[0].id)
  const [saved, setSaved] = useState(false)
  const duration = useMemo(() => projectDuration(segments), [segments])

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const project = JSON.parse(raw) as VoiceProject
      if (project.version === 1 && Array.isArray(project.segments)) {
        setTitle(project.title)
        setSegments(project.segments)
        setSelectedId(project.segments[0]?.id ?? '')
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const makeProject = (): VoiceProject => ({ version: 1, title: title.trim() || 'Untitled project', updatedAt: new Date().toISOString(), segments })
  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(makeProject()))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }
  const updateSegment = (id: string, patch: Partial<VoiceSegment>) => setSegments((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const addSegment = () => {
    const segment = createSegment(segments.at(-1))
    setSegments((items) => [...items, segment])
    setSelectedId(segment.id)
  }
  const removeSegment = (id: string) => {
    setSegments((items) => items.filter((item) => item.id !== id))
    if (selectedId === id) setSelectedId(segments.find((item) => item.id !== id)?.id ?? '')
  }
  const exportFile = (kind: 'txt' | 'csv' | 'json') => {
    const project = makeProject()
    const slug = (project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'hova-project').replace(/^-|-$/g, '')
    if (kind === 'txt') download(`${slug}-voices.txt`, toVoiceList(project), 'text/plain;charset=utf-8')
    if (kind === 'csv') download(`${slug}-voices.csv`, `\uFEFF${toCsv(project)}`, 'text/csv;charset=utf-8')
    if (kind === 'json') download(`${slug}.json`, JSON.stringify(project, null, 2), 'application/json')
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#101114] text-zinc-100">
      <header className="flex h-14 items-center gap-4 border-b border-white/10 bg-[#16171b] px-4">
        <div className="flex items-center gap-2 font-semibold"><Film className="size-5 text-violet-400" /> Hova Media</div>
        <input aria-label="Tên dự án" className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-3 py-1.5 text-sm font-medium outline-none hover:border-white/10 focus:border-violet-500/70" value={title} onChange={(event) => setTitle(event.target.value)} />
        <span className="hidden text-xs text-zinc-500 sm:inline">{segments.length} câu · {formatTime(duration)}</span>
        <Button variant="outline" className="border-white/10 bg-white/5 text-zinc-100" onClick={save}><Save /> {saved ? 'Đã lưu' : 'Lưu dự án'}</Button>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="hidden border-r border-white/10 bg-[#141519] p-4 lg:block">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Thư viện</p>
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Mic2 className="size-4 text-violet-400" /> Voice script</div>
            <p className="text-xs leading-5 text-zinc-400">Quản lý nội dung, giọng đọc và thời lượng cho từng đoạn.</p>
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-zinc-500"><FileAudio className="mx-auto mb-2 size-5" /> TTS provider sẽ được kết nối ở bước tiếp theo.</div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <div className="flex min-h-[280px] flex-1 items-center justify-center border-b border-white/10 bg-[radial-gradient(circle_at_center,#262331_0,#111216_62%)] p-8">
            <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl">
              <div className="flex h-full items-center justify-center p-8 text-center"><div>
                <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-violet-500/15"><Mic2 className="size-6 text-violet-400" /></div>
                <p className="text-lg font-semibold">Voice-first video workspace</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">Chọn một câu trên timeline để chỉnh nội dung và voice ở bảng bên phải.</p>
              </div></div>
            </div>
          </div>

          <div className="h-[300px] bg-[#15161a] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><p className="text-sm font-semibold">Timeline lời thoại</p><p className="text-xs text-zinc-500">1 ô tương ứng một đoạn voice</p></div>
              <Button variant="outline" className="border-white/10 bg-white/5 text-zinc-100" onClick={addSegment}><Plus /> Thêm câu</Button>
            </div>
            <div className="mb-2 flex h-7 border-b border-white/10 pl-24 text-[10px] text-zinc-600">{[0, 5, 10, 15, 20].map((second) => <span key={second} className="flex-1">{second}s</span>)}</div>
            <div className="flex items-stretch gap-2 overflow-x-auto pb-4">
              <div className="flex w-20 shrink-0 items-center gap-2 rounded-md bg-[#202126] px-2 text-xs text-zinc-400"><Mic2 className="size-3.5" /> Voice</div>
              {segments.map((segment, index) => (
                <button key={segment.id} className={`group min-w-36 rounded-md border p-3 text-left transition ${selectedId === segment.id ? 'border-violet-400 bg-violet-500/20' : 'border-white/10 bg-[#25262c] hover:border-white/20'}`} style={{ width: Math.max(144, segment.durationMs / 16) }} onClick={() => setSelectedId(segment.id)}>
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300"><GripVertical className="size-3" /> {index + 1}. {segment.voiceName}</div>
                  <p className="line-clamp-2 text-xs leading-5 text-zinc-300">{segment.text || 'Chưa có nội dung'}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="border-l border-white/10 bg-[#18191d] p-4">
          <div className="mb-5 flex items-center justify-between"><p className="text-sm font-semibold">Voice inspector</p><span className="rounded bg-violet-500/15 px-2 py-1 text-[10px] text-violet-300">MVP</span></div>
          {segments.map((segment, index) => segment.id === selectedId && (
            <div key={segment.id} className="space-y-4">
              <label className="block text-xs text-zinc-400">Nội dung câu {index + 1}<textarea className="mt-2 min-h-32 w-full resize-y rounded-md border border-white/10 bg-black/20 p-3 text-sm leading-6 text-zinc-100 outline-none focus:border-violet-500" value={segment.text} onChange={(event) => updateSegment(segment.id, { text: event.target.value })} /></label>
              <label className="block text-xs text-zinc-400">Voice name<input list="voice-names" className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-violet-500" value={segment.voiceName} onChange={(event) => updateSegment(segment.id, { voiceName: event.target.value })} /><datalist id="voice-names">{DEFAULT_VOICES.map((voice) => <option key={voice} value={voice} />)}</datalist></label>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Bắt đầu (ms)" value={segment.startMs} onChange={(value) => updateSegment(segment.id, { startMs: value })} />
                <NumberField label="Thời lượng (ms)" value={segment.durationMs} min={100} onChange={(value) => updateSegment(segment.id, { durationMs: value })} />
              </div>
              <Button variant="destructive" className="w-full" onClick={() => removeSegment(segment.id)}><Trash2 /> Xóa câu</Button>
            </div>
          ))}
          <div className="mt-8 border-t border-white/10 pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Xuất dữ liệu</p>
            <div className="grid grid-cols-3 gap-2">{(['txt', 'csv', 'json'] as const).map((kind) => <Button key={kind} variant="outline" className="border-white/10 bg-white/5 uppercase text-zinc-200" onClick={() => exportFile(kind)}><Download /> {kind}</Button>)}</div>
          </div>
        </aside>
      </section>
    </main>
  )
}

function NumberField({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return <label className="text-xs text-zinc-400">{label}<input type="number" min={min} step={100} className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500" value={value} onChange={(event) => onChange(Math.max(min, Number(event.target.value) || 0))} /></label>
}
