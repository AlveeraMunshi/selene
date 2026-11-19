import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '@/App'
import { useMissionStore } from '@/state/missionStore'
import { createSimulation, resolveIntervention, step, toRecord } from '@/core/engine'

describe('app smoke', () => {
  beforeEach(() => { cleanup() })

  it('renders the shell and the planner', async () => {
    render(<App />)
    expect(screen.getByText('SELENE')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /planner/i })).toBeInTheDocument()
    // preview is debounced; let it run
    await act(async () => { await new Promise(r => setTimeout(r, 250)) })
    expect(useMissionStore.getState().preview?.ok).toBe(true)
    expect(screen.getByText(/Route preview/)).toBeInTheDocument()
  })

  it('switches to the mission tab and shows the empty state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: /mission/i }))
    expect(screen.getByText(/No mission running/i)).toBeInTheDocument()
  })

  it('renders a live mission', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => { useMissionStore.getState().launch() })
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    useMissionStore.getState().pause()
    await user.click(screen.getByRole('tab', { name: /mission/i }))
    expect(screen.getByText(/Decision stream/)).toBeInTheDocument()
    expect(screen.getAllByText(/Traverse/).length).toBeGreaterThan(0)
    useMissionStore.getState().reset()
  })

  it('renders analysis for a finished mission', async () => {
    const user = userEvent.setup()
    const config = useMissionStore.getState().config
    let s = createSimulation(config)
    let n = 0
    while (s.outcome === null && n < 20000) {
      if (s.pendingIntervention) { s = resolveIntervention(s, s.pendingIntervention.options[0]!.id); continue }
      s = step(s); n++
    }
    const rec = toRecord(s, 'test-mission', new Date().toISOString())
    act(() => { useMissionStore.setState({ missions: [rec] }) })

    render(<App />)
    await user.click(screen.getByRole('tab', { name: /analysis/i }))
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
    expect(await screen.findByText(/Saved missions/)).toBeInTheDocument()
    expect(await screen.findByText(/Planned against executed/)).toBeInTheDocument()
    expect(await screen.findByText(/Power over time/)).toBeInTheDocument()
    expect(await screen.findByText(/Event log/)).toBeInTheDocument()
  })
})

describe('mission interaction', () => {
  it('surfaces the opening approval request and resolves it from the panel', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => { useMissionStore.getState().launch() })

    // Supervised autonomy: the engine asks before driving the first route.
    expect(useMissionStore.getState().state?.pendingIntervention).not.toBeNull()
    expect(useMissionStore.getState().status).toBe('paused')

    await user.click(screen.getByRole('tab', { name: /mission/i }))
    expect(screen.getByRole('alertdialog', { name: /operator decision required/i })).toBeInTheDocument()
    expect(screen.getByText(/will not advance until one of these is chosen/i)).toBeInTheDocument()

    const choose = screen.getAllByRole('button', { name: /^(choose|abort)$/i })[0]!
    await user.click(choose)
    expect(useMissionStore.getState().state?.pendingIntervention).toBeNull()

    useMissionStore.getState().pause()
    useMissionStore.getState().reset()
  })

  it('keeps keyboard shortcuts out of text inputs', async () => {
    const user = userEvent.setup()
    render(<App />)
    await act(async () => { await new Promise(r => setTimeout(r, 250)) })

    const seed = screen.getByRole('spinbutton')
    await user.click(seed)
    const before = useMissionStore.getState().speed
    // ']' would raise the speed if the shortcut fired while typing.
    await user.keyboard(']')
    expect(useMissionStore.getState().speed).toBe(before)

    // Outside an input it does fire.
    await user.click(document.body)
    await user.keyboard(']')
    expect(useMissionStore.getState().speed).toBeGreaterThan(before)
    act(() => { useMissionStore.getState().setSpeed(1) })
  })
})
