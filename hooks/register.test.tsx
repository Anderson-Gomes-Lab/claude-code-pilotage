import { expect, test } from 'claude-code/testing'

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

const PANE = {
  plugin: 'pilotage',
  component: 'Pane',
  requestId: 'pilotage',
  props: { title: 'Pilotage', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

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
  on('clock.every', () => ({ value: { cancel() {} } }))
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
