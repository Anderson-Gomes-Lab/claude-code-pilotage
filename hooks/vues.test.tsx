import { expect, test } from 'claude-code/testing'

// Each view of the pane, drawn by the engine's test kit: what a person reads, and where a press leads.
// Claude Code before $.ui.mount cannot draw: there these tests pass without running (.claude/verifier.sh refuses that).
const PANE = {
  plugin: 'pilotage',
  component: 'Pane',
  requestId: 'pilotage',
  surface: 'desktop',
  props: { title: 'Pilotage', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const PLAN = `# Pilotage : Site Test
Cap : maquette v6, lot 2 sur 3 : héros

## Sessions
| Session | Livrable | Dossier | État |
| --- | --- | --- | --- |
| Maquette | site | ~/x | en cours |
| Cookies | consentement | ~/x | rendu |

## Fronts de cette session
| Front | Fichiers | Agent | État |
| --- | --- | --- | --- |
| A. Héros | index.html, a.css | Héros · construction : refaire | en cours |
| Photos | img/ | — | à lancer |
| Cadrage | — | aucun | en cours |
| Pied | y | — | rendu |

## Fait
- Accueil validé

## À toi
- Valider la v6 : regarder le héros
- ! Choisir la photo

## En attente
- Zone : titre coupé
- Zone : carte vide
- Tester Safari
- Toi : confirmer le prix
`

const VOISINE = JSON.stringify({ id: 'zzz', maj: 1_000_000, demande: 'Refaire le pied. Et le chat.', auTravail: true, quoi: 'a lu x', agents: [{ nom: 'B · recherche : voir', statut: 'running', debut: 900_000 }] })
const BRIEF = 'Mission : refaire le haut. Puis relire.\n1. Libellé : la zone sera vue demain. Remplace « 35 km » partout.\n2. Tester sur Safari.'
const AGENTS = [
  { id: 'a1', description: 'A. Héros · construction : refaire le haut', type: 'general-purpose', status: 'running' },
  { id: 'a2', description: 'Hors plan · recherche : autre', type: 'general-purpose', status: 'failed' },
  { id: 'a3', description: 'Veille · recherche : attend', type: 'general-purpose', status: 'idle' },
]

type Scene = { plan?: string | null; agents?: any[]; voisine?: boolean }

const vue = (nom: string, scene: Scene, corps: (ui: any, textes: () => Promise<string[]>, $: any) => Promise<void>) =>
  test(nom, async ($: any, on: any) => {
    if (!$.ui.mount) return
    const dossier = '/Users/test/chantier'
    const fichiers = new Map<string, string>([['/home/test/.claude/pilotage/missions/abcdef12.json', JSON.stringify({ [AGENTS[0].description]: { mission: BRIEF, lance: 940_000 } })]])
    if (scene.plan !== null) fichiers.set(`${dossier}/PILOTAGE.md`, scene.plan ?? PLAN)
    if (scene.voisine) fichiers.set(`${dossier}/.pilotage/zzz.json`, VOISINE)
    on('command.register', () => ({ value: { command: 'panneau-pilotage' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('env.get', () => ({ value: '/home/test' }))
    on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: dossier }))
    on('session.id', () => ({ value: 'abcdef1234' }))
    on('session.turns', () => ({ value: 0 }))
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.every', () => ({ value: undefined }))
    on('agent.list', () => ({ value: scene.agents ?? [] }))
    on('tool.call', () => ({ result: {} }))
    on('fs.read', (_: any, e: any) => {
      const f = fichiers.get(String(e.path))
      if (f === undefined) throw new Error('absent')
      return { value: f }
    })
    on('fs.write', () => ({ value: undefined }))
    on('fs.stat', () => ({ value: { mtimeMs: 999_000 } }))
    on('fs.list', (_: any, e: any) => ({ value: [...fichiers.keys()].filter(k => k.startsWith(`${e.path}/`)).map(k => ({ name: k.slice(String(e.path).length + 1) })) }))
    await $.session.start({ cwd: dossier, surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount(PANE)
    await corps(ui, async () => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text), $)
    await ui.unmount()
  })

vue('no project: the pane says so', { plan: null }, async (_, textes) => {
  expect(await textes()).toContain('Aucun chantier lié à cette session')
})

vue('overview: live states from the session, intentions from the plan', { agents: AGENTS, voisine: true }, async (_, textes) => {
  const t = await textes()
  expect(t).toContain('Site Test')
  expect(t).toContain('☞ À toi · 2 points')
  expect(t).toContain('AGENTS EN COURS · 1')
  expect(t).toContain('Refaire le haut')
  expect(t).toContain('attend un message')
  expect(t).toContain('À LANCER · 1')
  expect(t).not.toContain('Cadrage')                // « en cours » in the plan, no agent seen
  expect(t).toContain('Refaire le pied')            // a live neighbour
  expect(t).toContain('Maquette')
  expect(t).not.toContain('en cours')               // the Sessions table repeats no plan state
})

vue('overview: without agents, no running group, and the plan’s Fait lines stand for Done', { plan: PLAN.replace('| Pied | y | — | rendu |\n', '') }, async (_, textes) => {
  const t = await textes()
  expect(t.some(x => x.startsWith('AGENTS EN COURS'))).toBe(false)
  expect(t).toContain('Accueil validé')
  expect(t).toContain('☞ À toi · 2 points · Claude t’attend')
})

vue('À toi: what blocks first, the plan’s detail below, and back', {}, async (ui, textes) => {
  await ui.press({ key: 'atoi' })
  const t = await textes()
  expect(t).toContain('Claude attend ta réponse pour continuer.')
  expect(t).toContain('À RÉPONDRE MAINTENANT')
  expect(t).toContain('QUAND TU PEUX')
  expect(t).toContain('1. Choisir la photo')
  expect(t).toContain('Regarder le héros')
  await ui.press({ key: 'retour' })
  expect(await textes()).toContain('OBJECTIF')
})

vue('the lead’s card', {}, async (ui, textes) => {
  await ui.press({ key: 'ici-b' })
  const t = await textes()
  expect(t).toContain('Chef · cette session')
  expect(t).toContain('Aucune action vue pour l’instant.')
})

vue('agent card: mission, steps, detail on demand', { agents: AGENTS }, async (ui, textes) => {
  await ui.press({ key: 'a1-b' })
  const t = await textes()
  expect(t).toContain('Refaire le haut.')
  expect(t).toContain('SES ÉTAPES')
  expect(t).toContain('Libellé')
  expect(t).not.toContain('Remplace « 35 km » partout.')
  await ui.press({ key: 'detail' })
  expect(await textes()).toContain('Remplace « 35 km » partout.')
})

vue('a failed agent offers to copy its error', { agents: AGENTS }, async (ui, textes) => {
  await ui.press({ key: 'a2-b' })
  expect((await textes())).toContain('CE QU’IL A RENDU')
  expect((await ui.findAll({ type: 'Button' })).some((b: any) => /Copier/.test(b.text ?? ''))).toBe(true)
})

vue('front card: what the plan says, nothing about an agent it never saw', {}, async (ui, textes) => {
  await ui.press({ key: 'Photos-b' })
  const t = await textes()
  expect(t).toContain('Selon le plan : à lancer')
  expect(t).toContain('PRÉVU POUR')
  expect(t).toContain('img/')
})

vue('another session and its agent', { voisine: true }, async (ui, textes) => {
  await ui.press({ key: 'zzz-b' })
  let t = await textes()
  expect(t).toContain('SA DEMANDE')
  expect(t).toContain('a lu x')
  await ui.press({ key: 'retour' })
  await ui.press({ key: 'zzzB · recherche : voir-b' })
  t = await textes()
  expect(t).toContain('en cours · 2 min')
  expect(t).toContain('Il tourne dans une autre session : son détail est dans cette session.')
})

vue('a next-batch topic and the whole list', { plan: `${PLAN}- Un : a\n- Deux : b\n` }, async (ui, textes) => {
  await ui.press({ key: 'suZone-b' })
  expect(await textes()).toContain('1. Titre coupé')
  await ui.press({ key: 'retour' })
  await ui.press({ key: 'su+-b' })
  const t = await textes()
  expect(t).toContain('ZONE · 2')
  expect(t).toContain('TOI, PLUS TARD · 1')
})

vue('Done: past three lines, a click shows them all', { plan: '# Pilotage : X\n## Fait\n- Un\n- Deux\n- Trois\n- Quatre\n' }, async (ui, textes) => {
  expect(await textes()).not.toContain('Quatre')
  await ui.press({ key: 'plus-Fait-b' })
  const t = await textes()
  expect(t).toContain('FAIT · 4')
  expect(t).toContain('Quatre')
})

vue('a lead task: its card, and a watch is not one', {}, async (ui, textes, $) => {
  await $.tool.call({ tool: 'Bash', description: 'Servir le site', command: 'npm run dev', run_in_background: true, tool_use_id: 'u1' })
  await $.tool.call({ tool: 'Bash', description: 'live updates for artifact 1', command: 'x', run_in_background: true, tool_use_id: 'u2' })
  const t = await textes()
  expect(t).toContain('TÂCHES DU CHEF · 1')
  await ui.press({ key: 'fondbu1-b' })
  const fiche = await textes()
  expect(fiche).toContain('À QUOI ELLE SERT')
  expect(fiche).toContain('npm run dev')
})

vue('a finished project says so under its title', { plan: '# Pilotage : X\nLivré : 12/11/2026\n' }, async (_, textes) => {
  expect(await textes()).toContain('Chantier livré · 12/11/2026')
})
