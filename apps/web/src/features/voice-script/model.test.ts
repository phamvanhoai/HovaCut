import { describe, expect, it, vi } from 'vitest'
import { createSegment, formatTime, projectDuration, toCsv, toVoiceList, type VoiceProject } from './model'

const project: VoiceProject = {
  version: 1,
  title: 'Demo',
  updatedAt: '2026-09-27T00:00:00.000Z',
  segments: [
    { id: '1', voiceName: 'Hoài My', text: 'Xin chào, "Hova"', startMs: 0, durationMs: 2200 },
    { id: '2', voiceName: 'Nam Minh', text: 'Câu thứ hai', startMs: 2500, durationMs: 3000 },
  ],
}

describe('voice script model', () => {
  it('formats timeline time', () => expect(formatTime(62_345)).toBe('01:02.345'))
  it('exports a readable voice list', () => expect(toVoiceList(project)).toContain('001 | Hoài My | 00:00.000 | Xin chào'))
  it('escapes CSV content', () => expect(toCsv(project)).toContain('Hoài My,0,2200,"Xin chào, ""Hova"""'))
  it('calculates project duration', () => expect(projectDuration(project.segments)).toBe(5500))
  it('places a new segment after the previous one', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'new-id' })
    expect(createSegment(project.segments[0])).toMatchObject({ id: 'new-id', startMs: 2200 })
    vi.unstubAllGlobals()
  })
})
