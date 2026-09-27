export type VoiceSegment = {
  id: string
  text: string
  voiceName: string
  startMs: number
  durationMs: number
}

export type VoiceProject = {
  version: 1
  title: string
  updatedAt: string
  segments: VoiceSegment[]
}

export const DEFAULT_VOICES = ['Hoài My', 'Nam Minh', 'Thu Hà'] as const

export function createSegment(previous?: VoiceSegment, overrides: Partial<VoiceSegment> = {}): VoiceSegment {
  return {
    id: crypto.randomUUID(),
    text: '',
    voiceName: previous?.voiceName ?? DEFAULT_VOICES[0],
    startMs: previous ? previous.startMs + previous.durationMs : 0,
    durationMs: 3000,
    ...overrides,
  }
}

export function formatTime(ms: number) {
  const safeMs = Math.max(0, Math.round(ms))
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const millis = safeMs % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function escapeCsv(value: string | number) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toVoiceList(project: VoiceProject) {
  return project.segments
    .map((segment, index) => `${String(index + 1).padStart(3, '0')} | ${segment.voiceName} | ${formatTime(segment.startMs)} | ${segment.text.trim()}`)
    .join('\n')
}

export function toCsv(project: VoiceProject) {
  const rows = project.segments.map((segment, index) =>
    [index + 1, segment.voiceName, segment.startMs, segment.durationMs, segment.text.trim()].map(escapeCsv).join(','),
  )
  return ['index,voice_name,start_ms,duration_ms,text', ...rows].join('\n')
}

export function projectDuration(segments: VoiceSegment[]) {
  return segments.reduce((duration, segment) => Math.max(duration, segment.startMs + segment.durationMs), 0)
}
