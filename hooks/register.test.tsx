import { expect, test } from 'claude-code/testing'

import { register } from './register'

const PLAN = `# Pilotage : Site Test
Cap : Maquette v6, lot 2 sur 3

## Sessions
| Session | Livrable | Dossier | État |
| --- | --- | --- | --- |
| Maquette | site | ~/x | en cours |
| Cookies | consentement | ~/x | en cours |

## Fronts de cette session
| Front | Fichiers | Agent | État |
| --- | --- | --- | --- |
| Héros | index.html | Héros · construction : refaire | en cours |
| Photos | img/ | — | à lancer |

## À toi
- Valider la v6

## En attente
- Avis Google statiques
`

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown

test('startup works with a plan and a running agent', async ($, on) => {
  on('command.register', () => ({ value: { command: 'panneau-pilotage' } }))
  const ouverts: string[] = []
  const ecrits: string[] = []
  on('ui.open', (_, e: any) => { ouverts.push(e.id); return { value: { isPlaced: true } } })
  on('env.get', () => ({ value: '/home/test' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/test/chantier' }))
  on('session.id', () => ({ value: 'abcdef1234' }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: 'Héros · construction : refaire', type: 'general-purpose', status: 'running' }] }))
  on('fs.read', (_, e: any) => ({ value: String(e.path).endsWith('PILOTAGE.md') ? PLAN : '[]' }))
  on('fs.write', (_, e: any) => { ecrits.push(String(e.path)); return { value: undefined } })
  on('fs.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/Users/test/chantier', surface: 'desktop', isInteractive: true })

  // rendering is not available in this version's test bench: we check the side effects
  await new Promise(r => setTimeout(r, 0))
  expect(ouverts).toContain('pilotage')
  expect(ecrits).toContain('/Users/test/chantier/.pilotage/abcdef12.json')
})

// a tool call whose answer comes later, as the picker's
function hookAttend(m: { lancer: any }, garder: (r: (x: any) => void) => void) {
  return m.lancer('tool.call', { tool: 'AskUserQuestion', questions: [{ question: 'On publie ?' }] }, () => new Promise(r => garder(r)))
}

// the pane cannot be drawn on this bench: a session's state is read from the file it shares
function moteur(agents: any[], tours = 0) {
  const hooks: Record<string, any[]> = {}
  const fichiers = new Map<string, string>([['/p/a/chantier/PILOTAGE.md', '# Pilotage : X\n']])
  let tic = () => {}, id = 'abcdef1234', now = 1_000_000
  const $: any = {
    command: { register: async () => {} }, env: { get: async () => '/h' },
    session: { cwd: async () => '/p/a/chantier', id: async () => id, turns: async () => tours },
    clock: { now: async () => now, every: (_: number, f: () => void) => { tic = f; return { cancel() {} } } },
    ui: { open: async () => {}, invalidate() {} }, agent: { list: async () => agents },
    fs: {
      read: async (p: string) => { if (!fichiers.has(p)) throw new Error('absent'); return fichiers.get(p) },
      write: async (p: string, x: string) => { fichiers.set(p, x) }, stat: async () => ({ mtimeMs: 1 }), list: async () => [],
    },
  }
  ;(register as any)((nom: string, a: any, b: any) => { (hooks[nom] ??= []).push(b ?? a) })
  const lancer = (nom: string, e: any, next: any = async (x: any) => x) => hooks[nom][0]($, e, next)
  const pause = () => new Promise(r => setTimeout(r, 1))
  return {
    lancer, id: (x: string) => { id = x }, fichier: (p: string) => fichiers.get(p),
    avancer: (ms: number) => { now += ms },
    tic: async () => { now += 5000; tic(); await pause() },
    etat: (s = 'abcdef12') => JSON.parse(fichiers.get(`/p/a/chantier/.pilotage/${s}.json`)!),
  }
}

test('a reload: unknown, an action shows a turn, and silence makes it unknown again', async () => {
  const m = moteur([], 3)
  await m.lancer('session.start', {})
  expect(m.etat().auTravail).toBe(null)
  await m.lancer('tool.call', { tool: 'Read', file_path: '/a' })
  await m.tic()
  expect(m.etat().auTravail).toBe(true)
  m.avancer(130_000)
  await m.tic()
  expect(m.etat().auTravail).toBe(null)
})

test('a tool call outside a turn does not put a known session to work', async () => {
  const m = moteur([])
  await m.lancer('session.start', {})
  await m.lancer('tool.call', { tool: 'Read', file_path: '/a' })
  await m.tic()
  expect(m.etat().auTravail).toBe(false)
})

test('a question on screen stops the session until it is answered', async () => {
  const m = moteur([])
  await m.lancer('session.start', {})
  await m.lancer('turn.start', { text: 'x' })
  let repondre = (_: any) => {}
  const appel = hookAttend(m, repondre2 => { repondre = repondre2 })
  await m.tic()
  expect(m.etat().auTravail).toBe(false)
  repondre({})
  await appel
  await m.tic()
  expect(m.etat().auTravail).toBe(true)
})

test('an agent gone from the list after its report counts as finished', async () => {
  const agents = [{ id: 'a', description: 'x', status: 'running' }]
  const m = moteur(agents)
  await m.lancer('session.start', {})
  await m.lancer('classic.SubagentStop', { agent_id: 'a', last_assistant_message: 'fait' })
  agents.length = 0
  await m.tic()
  expect(JSON.parse(m.fichier('/h/.claude/pilotage/finis/abcdef12.json')!)[0].statut).toBe('completed')
})

test('an interrupted turn stops « au travail »', async () => {
  const m = moteur([])
  await m.lancer('session.start', {})
  await m.lancer('turn.start', { text: 'x' })
  await m.tic()
  expect(m.etat().auTravail).toBe(true)
  await m.lancer('turn.complete', { reason: 'aborted' })
  await m.tic()
  expect(m.etat().auTravail).toBe(false)
})

test('a session that ends, /clear included, stops saying it works', async () => {
  const m = moteur([])
  await m.lancer('session.start', {})
  await m.lancer('turn.start', { text: 'x' })
  await m.lancer('classic.SessionEnd', { reason: 'clear' })
  expect(m.etat().maj).toBe(0)
  m.id('deadbeef00')
  await m.tic()
  expect(m.etat('deadbeef').auTravail).toBe(false)
  expect(m.etat('abcdef12').maj).toBe(0)
})

test('a report that arrives after the agent left the list still counts', async () => {
  const agents = [{ id: 'a', description: 'x', status: 'running' }]
  const m = moteur(agents)
  await m.lancer('session.start', {})
  agents.length = 0
  await m.tic()
  await m.lancer('classic.SubagentStop', { agent_id: 'a', last_assistant_message: 'fait' })
  agents.push({ id: 'b', description: 'y', status: 'failed' })
  await m.tic()
  expect(JSON.parse(m.fichier('/h/.claude/pilotage/finis/abcdef12.json')!)[0].statut).toBe('completed')
})

test('an agent gone from the list is no longer shared as running; an idle one neither', async () => {
  const agents = [{ id: 'a', description: 'x', status: 'running' }, { id: 'b', description: 'y', status: 'idle' }]
  const m = moteur(agents)
  await m.lancer('session.start', {})
  expect(m.etat().agents.map((a: any) => a.nom)).toEqual(['x'])
  agents.length = 0
  await m.tic()
  expect(m.etat().agents).toEqual([])
})
