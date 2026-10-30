import type { Register } from 'claude-code'

import type { Agent, Ligne, Plan, Voisine, Pas } from '../types'

// Pilotage panel: reads the project's PILOTAGE.md, tracks the session's agents,
// shares their state with the project's other sessions (.pilotage/ folder),
// and compares each duration with past real durations (~/.claude/pilotage/durees.json).

const PANE = 'pilotage'
const TYPES = ['recherche', 'contrôle', 'construction', 'correction']
const MOTS: [string, string][] = [
  ['contrôle', 'contrôle'], ['relecture', 'contrôle'], ['relis', 'contrôle'],
  ['recherche', 'recherche'], ['analyse', 'recherche'], ['enquête', 'recherche'],
  ['corrig', 'correction'], ['correction', 'correction'], ['appliquer', 'correction'],
  ['construi', 'construction'], ['lot ', 'construction'], ['rythme', 'construction'],
]
const FINIS = ['completed', 'failed', 'killed']
// Every state the panel shows: its word, its dot, its color, and the Team group it falls in
type Etat = { texte: string; point: string; couleur: string; groupe: 'cours' | 'lancer' | 'fait' }
const ETATS: Record<string, Etat> = {
  enCours: { texte: 'en cours', point: '●', couleur: 'suggestion', groupe: 'cours' },
  attend: { texte: 'attend', point: '●', couleur: 'warning', groupe: 'cours' },
  rendu: { texte: 'rendu', point: '✓', couleur: 'success', groupe: 'fait' },
  echec: { texte: 'échec', point: '✗', couleur: 'error', groupe: 'fait' },
  arrete: { texte: 'arrêté', point: '✗', couleur: 'error', groupe: 'fait' },
  // a plan line in failure still needs someone, unlike an agent that ended
  echecPlan: { texte: 'échec', point: '○', couleur: 'error', groupe: 'cours' },
  aLancer: { texte: 'à lancer', point: '○', couleur: 'inactive', groupe: 'lancer' },
}
const PAUSE_MS = 120_000

type Duree = { type: string; minutes: number; outils: number }

const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/'
const segments = (p: string) => p.split('/').filter(Boolean).length
const VIEUX_MS = 30 * 60_000 // a session silent for 30 min is no longer shown

// « Héros · construction : refaire le haut » → front Héros, type construction
export function lireNom(nom: string): { front: string; type: string } {
  const m = nom.match(/^(.+?)\s*·\s*(\p{L}+)\s*:/iu)
  if (m && TYPES.includes(m[2].toLowerCase())) return { front: m[1].trim(), type: m[2].toLowerCase() }
  const bas = nom.toLowerCase()
  const type = MOTS.find(([mot]) => bas.includes(mot))?.[1] ?? 'autre'
  const front = nom.includes(':') ? nom.split(':')[0].trim() : ''
  return { front, type }
}

const tableau = (bloc: string): Ligne[] =>
  bloc.split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .slice(1)
    .map(l => ({ cells: l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()) }))

const liste = (bloc: string) =>
  bloc.split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.trim().slice(2))
    // « rien … » and a line wholly in parentheses are notes, not items
    .filter(l => !/^[(_*]*rien\b/i.test(l) && !/^\([^()]*\)$/.test(l))

// Splits a plan sentence into two readable lines: before and after the first separator.
export function couper(texte: string, sep: string): [string, string] {
  const i = texte.indexOf(sep)
  return i < 0 ? [majuscule(texte.trim()), ''] : [majuscule(texte.slice(0, i).trim()), majuscule(texte.slice(i + sep.length).trim())]
}

// The band above the input box: the panel's essentials on one line.
export function resume(plan: Plan, enCours: number, enPlus = 0): string {
  const [, etape] = couper(plan.cap, ', ')
  const [numero] = couper(etape, ' : ')
  return [
    'Pilotage',
    numero,
    enCours > 0 ? `${enCours} agent${enCours > 1 ? 's' : ''} en cours` : '',
    plan.atoi.length + enPlus > 0 ? `À toi : ${plan.atoi.length + enPlus}` : '',
  ].filter(Boolean).join(' · ')
}

// Time spent on the project: sum of the duree_min column of a temps.csv log (empty lines ignored).
export function tempsPasse(csv: string): number {
  const lignes = csv.split(/\r?\n/).filter(l => l.trim())
  if (!lignes.length) return 0
  const cellules = (l: string) => {
    const out: string[] = []; let cur = '', q = false
    for (const c of l) {
      if (c === '"') q = !q
      else if (c === ',' && !q) { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out
  }
  const col = cellules(lignes[0]).indexOf('duree_min')
  if (col < 0) return 0
  return lignes.slice(1).reduce((t, l) => t + (Number(cellules(l)[col]) || 0), 0)
}

// 45 min, 2 h 30, 12 h: no needless decimal
export function duree(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return h >= 10 || r === 0 ? `${Math.round(m / 60)} h` : `${h} h ${String(r).padStart(2, '0')}`
}

// A tool action in plain words, for the feed: « a lu register.tsx », « a lancé les tests »
export function action(outil: string, x: Record<string, unknown>): string {
  const court = (v: unknown, n = 60) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
  const fichier = (v: unknown) => String(v ?? '').split('/').pop() || 'un fichier'
  switch (outil) {
    case 'Read': return `a lu ${fichier(x.file_path)}`
    case 'Write': return `a écrit ${fichier(x.file_path)}`
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `a modifié ${fichier(x.file_path ?? x.notebook_path)}`
    // never the command itself: it may contain a secret
    case 'Bash': return x.description ? `a lancé : ${court(x.description)}` : 'a lancé une commande'
    case 'Grep': return `a cherché « ${court(x.pattern, 40)} » dans le code`
    case 'Glob': return `a listé ${court(x.pattern, 40)}`
    case 'WebSearch': return `a cherché en ligne « ${court(x.query, 50)} »`
    case 'WebFetch': { const h = String(x.url ?? '').match(/^https?:\/\/([^/]+)/)?.[1]; return `a lu la page ${h ?? 'web'}` }
    case 'Agent': return `a lancé l'agent ${court(x.description, 50)}`
    case 'SendMessage': return 'a envoyé un message à un agent'
    default: return `a utilisé ${outil.replace(/^mcp__.*__/, '')}`
  }
}

// End of an agent's report: « En une phrase : … » and « Pourquoi : … » (pilotage skill)
export function extraire(texte: string): { resume: string; pourquoi: string } {
  const net = texte.replace(/\*\*/g, '')
  // the last line starting with the label: the summary is at the end of the report
  const lire = (motif: RegExp) => ([...net.matchAll(motif)].pop()?.[1] ?? '').trim().replace(/^[«"]\s*|\s*[»"]$/g, '')
  return { resume: lire(/^\s*(?:[-*]\s*)?En une phrase\s*:\s*(.+)$/gim), pourquoi: lire(/^\s*(?:[-*]\s*)?Pourquoi\s*:\s*(.+)$/gim) }
}

// First sentence of a brief, to state the mission in one line
export function unePhrase(texte = '', n = 160): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  // end of sentence: a word of at least two letters, then . ! ? (not « S.A. »)
  const p = t.match(/^(.+?[a-zà-ÿ0-9)»"']{2}[.!?])(\s|$)/)?.[1] ?? t
  return p.length > n ? p.slice(0, n - 1) + '…' : p
}

// An agent belongs to a front if its front has the same name, or if their names
// share at least two meaningful words (« Front B : bandeau cookies » ↔ « B. Bandeau cookies pleine largeur »)
export function appartient(agent: { front: string; nom: string }, front: string): boolean {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (norm(agent.front) === norm(front)) return true
  const mots = (x: string) => new Set(norm(x).split(/[^a-z0-9.]+/).filter(m => m.length >= 4 && m !== 'front'))
  const a = mots(agent.nom), f = mots(front)
  return [...a].filter(m => f.has(m)).length >= 2
}

const CODE_FRONT = /^(?:[Ff]ront\s+)?([A-Z]\d{0,2})\s*[.:·)]\s/

// Letter of a front: « F. Pied de page… » or « Front F : pied de page… » → « F »
export function codeFront(x = ''): string {
  return x.match(CODE_FRONT)?.[1] ?? ''
}

// A list split into pieces (comma, semicolon, « + »), without splitting inside parentheses
export function morceaux(texte = ''): string[] {
  const out: string[] = []
  let cur = '', prof = 0
  for (const c of texte) {
    if (c === '(') prof++
    if (c === ')') prof = Math.max(0, prof - 1)
    if (prof === 0 && (c === ',' || c === ';' || c === '+')) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out.map(m => m.trim()).filter(Boolean).map(majuscule)
}

// The readable mission: the brief's « Mission : … » line, otherwise its first sentence
export function mission(brief = ''): string {
  // one sentence only: the path, command or address that follow are for the agent
  const m = brief.match(/^\s*(?:Mission|Objectif)\s*:\s*(.+)$/im)?.[1]?.trim()
  return majuscule(unePhrase(sansMarques(m || brief.replace(/^\s*(?:Mission|Objectif)\s*:\s*/i, '')), 240))
}

// Steps of a brief: its numbered lines (« 1. … »), in order
export function etapes(brief = ''): string[] {
  const out: string[] = []
  let dans = false
  for (const l of brief.split('\n')) {
    const n = l.match(/^\s*\d+[.)]\s+(.+)/)
    if (n) { out.push(n[1].trim()); dans = true; continue }
    // the rest of a step (indented lines) stays attached to it; anything else closes it
    if (dans && /^\s+\S/.test(l)) out[out.length - 1] += '\n' + l.trim().replace(/^[-•*]\s*/, '• ')
    else dans = false
  }
  return out.slice(0, 12)
}

// A step split at its first « : » outside quotes: what comes before (the theme) and the rest
function couperEtape(x = ''): { avant: string; corps: string } {
  const [brute, ...suite] = x.split('\n')
  // a bold theme (« **Titre** … ») is the title, whatever follows
  const gras = brute.match(/^\s*\*\*(.+?)\*\*\s*:?\s*(.*)$/)
  if (gras) return { avant: sansMarques(gras[1]).replace(/\s*:\s*$/, ''), corps: sansMarques([gras[2], ...suite].join('\n')).trim() }
  const premiere = sansMarques(brute)
  let i = -1, dans = 0
  for (let k = 0; k < premiere.length && i < 0; k++) {
    if (premiere[k] === '«' || premiere[k] === '(') dans++
    else if (premiere[k] === '»' || premiere[k] === ')') dans = Math.max(0, dans - 1)
    else if (premiere[k] === ':' && !dans && premiere[k + 1] === ' ' && premiere.slice(0, k).trim()) i = k
  }
  if (i < 0) return { avant: '', corps: sansMarques(x).trim() }
  return { avant: premiere.slice(0, i).trim(), corps: sansMarques([premiere.slice(i + 1).trim(), ...suite].join('\n')).trim() }
}

// Markdown bold and code are not shown in the panel: their marks are removed
const sansMarques = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '').replace(/`/g, '')

// A summarized step: a short title (the theme, up to the first comma) and one line (the first sentence after it)
export function etapeCourte(x = '', n = 80): { titre: string; ligne: string } {
  const { avant, corps } = couperEtape(x)
  if (!avant) return { titre: uneLigne(phrases(corps)[0] ?? '', 60), ligne: '' }
  const phrase = (phrases(corps)[0] ?? '').replace(/^«\s*/, '').replace(/\s*»\s*\.?$/, '').replace(/^([^«]*?)\s*»/, '$1')
  return { titre: uneLigne(avant.split(',')[0].trim(), 40), ligne: uneLigne(majuscule(phrase), n) }
}

// A full step: the whole theme, then one line per sentence (a single split, nothing lost or repeated),
// bullets apart, technical instructions (command, path, file) in small type
export function detailEtape(x = ''): { titre: string; lignes: { texte: string; puce: boolean; technique: boolean }[] } {
  const { avant, corps } = couperEtape(x)
  const ps = phrases(corps)
  const [titre, reste] = avant ? [avant, ps] : [ps[0] ?? '', ps.slice(1)]
  return {
    titre,
    lignes: reste.map(l => {
      const puce = /^•\s*/.test(l)
      const brut = l.replace(/^•\s*/, '').replace(/\s*[;,]\s*$/, '').trim()
      const technique = /\b[\w.-]+\/(\s|$|[\w.-]+\/)|\.(md|mjs|js|json|html|css|py|tsx?)\b|JSON-LD|\bgrep\b/i.test(brut)
      const texte = /^[\w.-]+\/|^\./.test(brut) ? brut : majuscule(brut)
      return { texte, puce, technique }
    }),
  }
}

// Does the detail add anything to the summary? If not, no button to expand it
export function aDuDetail(x = ''): boolean {
  const c = etapeCourte(x), d = detailEtape(x)
  return d.titre !== c.titre || d.lignes.length > (c.ligne ? 1 : 0) || (d.lignes.length === 1 && d.lignes[0].texte !== c.ligne)
}

// A step in short lines: one sentence per line, bullets apart
export function phrases(texte = ''): string[] {
  // no split after an initial (« M. X », « S.A. »)
  return texte.split('\n').flatMap(l => l.split(/(?<=[.!?…])(?<!(?:^|[^\p{L}])[A-ZÀ-Ý]\.)\s+(?=[«A-ZÀ-Ý•])/u)).map(x => x.trim()).filter(Boolean)
}

// What a lead task does, in plain words
export function nomTache(quoi = ''): string {
  if (/live updates? for artifact/i.test(quoi)) return 'Suivi d’une page publiée'
  return quoi
}

export function aQuoiSert(quoi = '', commande = ''): string {
  const tout = `${quoi} ${commande}`
  if (/live updates? for artifact|artifact/i.test(tout)) return 'Garde à jour une page publiée (artifact) pendant que Claude la modifie. Elle tourne tant que la session est ouverte.'
  if (/http\.server|\bserve\b|servir|npm run (dev|start)|vite|localhost|--port/i.test(tout)) return 'Sert le site sur ta machine, pour le regarder dans le navigateur. Elle tourne jusqu’à ce que Claude l’arrête.'
  if (/test|verifier|vérifier|pytest|playwright/i.test(tout)) return 'Lance des tests en arrière-plan. Claude lit le résultat quand ils finissent.'
  return 'Commande lancée en arrière-plan. Claude reçoit son résultat quand elle finit.'
}

// One line at most: cut cleanly
export function uneLigne(texte: string, n = 48): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s·,;:–-]+$/, '') + '…' : t
}

const PREFIXE_TYPE = /^.+?·\s*\p{L}+\s*:\s*/iu // « Front · type : »

// Displayed agent name: without « Front · type : » or « Front A : », first letter capitalized
export function nomCourt(nom: string): string {
  return majuscule(nom.replace(PREFIXE_TYPE, '').replace(/^front\s+\S+\s*:\s*/i, '').trim() || nom)
}

// Heights measured on a panel screenshot (units = Retina screen pixels):
// top down to the lead 585, group 62 + 64 per line, next batch 116 + 80 per line, bottom 60.
// One surface row ≈ 36 units: measured on a screenshot (43 rows for a 1570-unit panel).
export const UNITE_RANGEE = 36
export function sujetsVisibles(x: { rangees?: number; groupes: number[]; fil: boolean; ligne2: boolean; autres: number; sujets: number }): number {
  if (!x.rangees) return Math.min(3, x.sujets)
  const pris = 585 + (x.fil ? 40 : 0) - (x.ligne2 ? 0 : 45) + x.groupes.reduce((t, n) => t + 62 + 64 * n, 0) + (x.autres ? 80 + 64 * x.autres : 0) + 116 + 60
  const place = Math.floor((x.rangees * UNITE_RANGEE - pris) / 80)
  if (place >= x.sujets) return x.sujets
  return Math.max(1, place - 1) // one line kept for « + N autres »
}

const PROCHAIN = 'Pour plus tard.'

// Next batch sorted by topic: « Sujet : tâche »; without a topic, the task goes to « À ranger »;
// a « Toi : … » line is for the person, not for an agent
export function sujets(attente: string[]): { nom: string; taches: string[] }[] {
  const m = new Map<string, string[]>()
  for (const l of attente) {
    // a topic is a short name (four words at most, no parenthesis or quote); otherwise the colon is part of the sentence
    const m2 = l.match(/^([^:()«»"]{1,40}?)\s*:\s+(.+)$/)
    const [nom, tache] = m2 && m2[1].trim().split(/\s+/).length <= 4 ? [majuscule(m2[1].trim()), majuscule(m2[2].trim())] : ['À ranger', l]
    if (/^toi$/i.test(nom)) { m.set('Toi, plus tard', [...(m.get('Toi, plus tard') ?? []), tache]); continue }
    m.set(nom, [...(m.get(nom) ?? []), tache || nom])
  }
  return [...m].map(([nom, taches]) => ({ nom, taches })).sort((a, b) => b.taches.length - a.taches.length)
}

export function lirePlan(texte: string, dossier: string): Plan {
  const sections: Record<string, string> = {}
  let courant = ''
  for (const l of texte.split('\n')) {
    const h = l.match(/^##\s+(.+)/)
    if (h) { courant = h[1].toLowerCase(); sections[courant] = ''; continue }
    if (courant) sections[courant] += l + '\n'
  }
  const cle = (debut: string) => Object.keys(sections).find(k => k.startsWith(debut)) ?? ''
  const titre = texte.match(/^#\s+Pilotage\s*:\s*(.+)$/m)?.[1]?.trim()
  const attente = liste(sections[cle('en attente')] ?? '')
  return {
    chantier: majuscule((titre ?? dossier.split('/').pop() ?? 'chantier').trim()),
    dossier,
    cap: texte.match(/^Cap\s*:\s*(.+)$/m)?.[1]?.trim()
      ?? majuscule(cle('fronts').match(/\(([^)]+)\)/)?.[1] ?? ''),
    sessions: tableau(sections[cle('sessions')] ?? ''),
    fronts: tableau(sections[cle('fronts')] ?? ''),
    // « À toi » = what the person can do now; « Toi : » in « En attente » is for later and stays there
    atoi: liste(sections[cle('à toi')] ?? ''),
    attente,
    fait: liste(sections[cle('fait')] ?? ''),
    livre: texte.match(/^Livré\s*:\s*(.+)$/m)?.[1]?.trim() ?? '',
  }
}

// under the title: a finished project, or a flight plan nobody updated for days
export function sousTitre(p: Pick<Plan, 'livre' | 'maj'>, t: number): string {
  if (p.livre) return `Chantier livré · ${p.livre}`
  const jours = p.maj ? Math.floor((t - p.maj) / 86400000) : 0
  return jours >= 3 ? `Plan de vol mis à jour il y a ${jours} jours` : ''
}

// another session's name: the first sentence of what it was asked
export function nomSession(demande?: string): string {
  const texte = (demande ?? '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^\d+[.)]\s+/, '')
  // a sentence ends on a mark followed by a space, not inside « v0.24 », « site.js » or « M. Durand »
  return texte.split(/(?<=[\p{L}\d)]{2})[.?!](?:\s|$)|\n/u)[0].trim() || 'Autre session'
}

export function etatVoisine(s: Pick<Voisine, 'maj' | 'auTravail' | 'agents'>, t: number): string {
  return t - s.maj > PAUSE_MS ? 'en pause' : s.auTravail === false && !s.agents.length ? 'attend' : 'au travail'
}

// « Claude t'attend » only for a blocking point: the other points are the person's own to-do, not a stop
export const attendToi = (bloquants: number, arret: boolean) => arret && bloquants > 0
export function phraseAToi(bloquants: number, arret: boolean, relit: boolean): string {
  if (relit) return 'Claude réfléchit : ces points peuvent changer.'
  if (!bloquants) return 'Rien ne bloque : à faire quand tu peux.'
  return arret ? 'Claude attend ta réponse pour continuer.' : 'Tu peux répondre tout de suite : ton message attend son tour, Claude ne s’arrête pas.'
}

// « À toi » as shown: the plan's points and the end-of-turn question, what blocks progress first
export function lireAToi(atoi: string[], question: string, demandeFinie: boolean, agentsFinis: boolean) {
  const points = atoi.map(l => ({ t: l.replace(/^!\s*/, ''), bloque: /^!/.test(l) }))
  // the end-of-turn question only counts once the turn is over: as soon as Claude works again, it no longer waits
  if (question && demandeFinie) {
    const meme = points.find(x => appartient({ front: '', nom: x.t }, question))
    if (meme) meme.bloque = true
    else points.unshift({ t: `Répondre : ${question}`, bloque: true })
  }
  const bloquants = new Set(points.filter(x => x.bloque).map(x => x.t))
  // nothing is running anymore: what comes next is up to you
  // (background tasks do not decide this: servers and watches run forever)
  const arret = demandeFinie && agentsFinis
  return {
    points: [...points.filter(x => x.bloque), ...points.filter(x => !x.bloque)].map(x => x.t),
    bloquants,
    arret,
    attend: attendToi(bloquants.size, arret),
  }
}

// After a message from the person, earlier points no longer count until Claude has reread « À toi »
// (it rewrites it, or ends its turn): `avant` is the list seen at that message
export function relecture(relit: boolean, avant: string | null, cle: string): { relit: boolean; avant: string | null } {
  if (!relit) return { relit, avant }
  return avant === null ? { relit, avant: cle } : { relit: avant === cle, avant }
}

// At the end of a turn: a message typed during that turn waits for the next one
export const lireApresTour = (relit: boolean, debutTour: number, relitDepuis: number) => relit && debutTour < relitDepuis

// The line at the top of the panel; with a color, it leads to the points
export function bandeauAToi(x: { points: number; attend: boolean; reflechit: boolean; auTravail: number }): { texte: string; couleur?: string } {
  if (!x.points) return { texte: x.auTravail > 0 ? '⏳ Claude travaille' : 'Rien à faire pour toi' }
  if (x.reflechit) return { texte: '⏳ Claude réfléchit · rien à faire' }
  return {
    texte: `☞ À toi · ${x.points} point${x.points > 1 ? 's' : ''}${x.attend ? ' · Claude t’attend' : ''}`,
    couleur: x.attend ? 'warning' : 'suggestion',
  }
}

export const groupesAToi = (points: string[], bloquants: Set<string>) => [
  { nom: 'À répondre maintenant', taches: points.filter(x => bloquants.has(x)) },
  { nom: bloquants.size ? 'Quand tu peux' : `À toi · ${points.length}`, taches: points.filter(x => !bloquants.has(x)) },
].filter(g => g.taches.length > 0)

export function etatChef(demandeFinie: boolean, points: number, taches: number): string {
  if (!demandeFinie) return 'au travail'
  if (points > 0) return ''
  return taches > 0 ? 'attend ses tâches' : 'en pause'
}

export function etatAgent(a: { statut: string; fin?: number }): Etat {
  if (a.statut === 'failed') return ETATS.echec
  if (a.statut === 'killed') return ETATS.arrete
  if (a.fin || a.statut === 'completed') return ETATS.rendu
  return a.statut === 'waiting' ? ETATS.attend : ETATS.enCours
}

export function etatDuPlan(etat = ''): Etat {
  const e = etat.toLowerCase()
  if (e.startsWith('contrôl') || e.startsWith('rendu')) return ETATS.rendu
  if (e.startsWith('en cours')) return ETATS.enCours
  return e.startsWith('échec') ? ETATS.echecPlan : ETATS.aLancer
}

export const sansAgent = (cellule = '') => /^[\s—–-]*$/.test(cellule)

// what the model is told in every session: the mod is useless if nobody feeds PILOTAGE.md
export function rappel(dossier?: string): string {
  return dossier
    ? `The person watches a Pilotage pane that displays ${dossier}/PILOTAGE.md live. Follow the skill pilotage:method. Say in one line how you route each message. « À toi » says what they can do now, nothing else: update it during this turn, first of all if their message answers it. Add a line to « Fait » when a batch ends.`
    : 'The Pilotage mod is installed. When the person starts or resumes a project with a deliverable and several steps, use the skill pilotage:method before producing anything: it writes the PILOTAGE.md the pane displays. For a question or a small one-off task, do nothing and do not mention it.'
}

const mediane = (v: number[]) => v[Math.floor((v.length - 1) / 2)]
const centile80 = (v: number[]) => v[Math.floor(0.8 * (v.length - 1))]

// Usual range from history; above the median, only past agents
// that lasted at least as long are kept (long-tailed durations).
export function estimer(type: string, ecoule: number, durees: Duree[]) {
  const passes = durees.filter(d => d.type === type)
  if (passes.length < 5) return null
  const minutes = passes.map(d => d.minutes).sort((a, b) => a - b)
  const outils = passes.map(d => d.outils).sort((a, b) => a - b)
  let bas = mediane(minutes)
  let haut = centile80(minutes)
  const long = ecoule > haut
  if (ecoule > bas) {
    const restants = minutes.filter(m => m >= ecoule)
    if (restants.length < 3) return { bas: 0, haut: 0, long: true, outils: mediane(outils), fourchette: false }
    bas = mediane(restants); haut = centile80(restants)
  }
  return { bas, haut, long, outils: mediane(outils), fourchette: true }
}

const afficher = async ($: any) => { await $.ui.open({ id: PANE, title: 'Pilotage' }); $.ui.invalidate('ui.render') }
const min = (ms: number) => Math.max(0, Math.round(ms / 60000))

export const register: Register = on => {
  // Data held in module memory: reset on every reload of the mod.
  const suivis = new Map<string, Agent>()
  const missions = new Map<string, string>()
  let durees: Duree[] = []
  let dossier = ''
  let fichierDurees = ''
  let moi = ''
  let choisi = ''
  let retour = ''
  let etapesDetail = false // agent card: full steps rather than title + one line
  let plan: Plan | null = null
  let rappele = false
  let voisines: Voisine[] = []
  const fils = new Map<string, Pas[]>() // action feed per agent, from its first action
  let filSession: Pas[] = []
  let demande = ''
  let relit = false // a message from the person just arrived: « À toi » may already be answered
  let atoiAvant: string | null = null
  let relitDepuis = 0, debutTour = 0 // a message typed during a turn waits for the next one: only the end of that turn counts it as read
  let questionLive = '' // last question asked by the session, until the answer
  let demandeFinie = true // the last request typed in this session
  // background work that is not an agent (command, watch, workflow): the engine's list at each end of turn
  let fond: { id: string; quoi: string; debut: number; commande?: string }[] = []
  let restaure = false
  let finisAEcrire = false // report arrived: the saved copy must follow
  let passe = 0 // minutes logged in the project's temps.csv
  let maintenant = 0
  let fichierLien = ''
  let fichierFinis = '' // finished agents of this session, kept outside the project
  let ecranVu = 0 // last height seen, noted to tune the estimate
  let fichierEcran = ''
  let fichierMissions = '' // briefs of this session's agents, reread after a mod reload
  let chercher = true
  let arreter: { cancel: () => void } | null = null
  const lances = new Map<string, number>()
  const actions = new Map<string, number>() // actions per agent, counted from the start
  let parDossier = false // project found from the working folder: it takes priority
  let relancer: (() => Promise<void>) | null = null
  let ouvrirPanneau: (() => void) | null = null
  const enCours = () => [...suivis.values()].filter(a => !a.fin)
  const finDeTour = () => { demandeFinie = true; relit = lireApresTour(relit, debutTour, relitDepuis) }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panneau-pilotage', description: 'Ouvrir le panneau Pilotage du chantier' })
    const cwd = await $.session.cwd()
    moi = (await $.session.id()).slice(0, 8)
    const maison = (await $.env.get("HOME")) ?? ''
    fichierDurees = maison ? `${maison}/.claude/pilotage/durees.json` : ''
    try { durees = fichierDurees ? JSON.parse(await $.fs.read(fichierDurees)) : [] } catch { durees = [] }

    // THIS session's project: PILOTAGE.md above the working folder,
    // otherwise the one the session opened or wrote (link kept in ~/.claude/pilotage/sessions/).
    // Never another session's project: without a link, the panel says so.
    const nommerFichiers = () => {
      fichierLien = maison ? `${maison}/.claude/pilotage/sessions/${moi}.txt` : ''
      fichierFinis = maison ? `${maison}/.claude/pilotage/finis/${moi}.json` : ''
      fichierMissions = fichierFinis.replace('/finis/', '/missions/')
    }
    nommerFichiers()
    fichierEcran = maison ? `${maison}/.claude/pilotage/ecran.json` : ''
    const ouvrir = () => { void afficher($) }
    const trouver = async () => {
      const avant = dossier
      for (let d = cwd; segments(d) > 2 && !dossier; d = parent(d)) {
        try { await $.fs.read(`${d}/PILOTAGE.md`); dossier = d; parDossier = true } catch { /* higher up */ }
      }
      if (!dossier && fichierLien) {
        try { dossier = (await $.fs.read(fichierLien)).trim() } catch { /* no link yet */ }
      }
      // project found along the way (file created by an agent or a script): open only
      if (dossier && dossier !== avant) ouvrir()
    }
    relancer = async () => { chercher = false; await trouver() }
    ouvrirPanneau = ouvrir

    let tour = 0
    const rafraichir = async () => {
      maintenant = await $.clock.now()
      // /clear gives a new session without session.start: start from scratch
      const id = (await $.session.id()).slice(0, 8)
      if (id !== moi) {
        moi = id
        rappele = false
        nommerFichiers()
        suivis.clear()
        filSession = []
        demande = ''
        questionLive = ''
        fond = []
        demandeFinie = true
        missions.clear()
        lances.clear()
        restaure = false
        if (!parDossier) { dossier = ''; plan = null }
        chercher = true
      }
      if (!dossier && (chercher || tour % 6 === 0)) { chercher = false; await trouver() }
      tour++
      // kept finished agents: reread before the list, so an empty copy does not overwrite them
      if (!restaure && fichierFinis) {
        restaure = true
        try {
          for (const a of JSON.parse(await $.fs.read(fichierFinis)) as Agent[]) {
            suivis.set(a.id, a)
            if (a.fil) fils.set(a.id, a.fil)
          }
        } catch { /* first time */ }
        try {
          const m = JSON.parse(await $.fs.read(fichierMissions)) as Record<string, { mission: string; lance: number }>
          for (const [d, v] of Object.entries(m)) {
            if (!missions.has(d)) missions.set(d, v.mission)
            if (!lances.has(d)) lances.set(d, v.lance)
          }
        } catch { /* no saved brief */ }
      }
      let finiNeuf = false
      for (const i of await $.agent.list()) {
        const a = suivis.get(i.id)
        if (!a) {
          const { front, type } = lireNom(i.description)
          const lance = lances.get(i.description)
          suivis.set(i.id, {
            id: i.id, nom: i.description, nomCourt: i.name, front, type, statut: i.status,
            debut: lance ?? maintenant, departVu: lance !== undefined,
            fin: FINIS.includes(i.status) ? maintenant : undefined,
            outils: actions.get(i.id) ?? 0, messages: 0, mission: missions.get(i.description), fil: fils.get(i.id),
          })
          continue
        }
        a.statut = i.status
        a.outils = actions.get(i.id) ?? a.outils
        a.fil = fils.get(i.id) ?? a.fil
        if (FINIS.includes(i.status) && !a.fin) {
          a.fin = maintenant
          finiNeuf = true
          // only an agent whose start we saw; the file is reread just before (concurrent sessions)
          if (a.departVu && fichierDurees) {
            try { durees = JSON.parse(await $.fs.read(fichierDurees)) } catch { /* keep the copy */ }
            durees.push({ type: a.type, minutes: Math.round((a.fin - a.debut) / 6000) / 10, outils: a.outils })
            try { await $.fs.write(fichierDurees, JSON.stringify(durees)) } catch { /* the history will wait */ }
          }
        }
      }
      if ((finiNeuf || finisAEcrire) && fichierFinis) {
        finisAEcrire = false
        const finis = [...suivis.values()].filter(a => a.fin).slice(-20)
        try { await $.fs.write(fichierFinis, JSON.stringify(finis)) } catch { /* kept in memory only */ }
      }
      if (dossier) {
        try { plan = { ...lirePlan(await $.fs.read(`${dossier}/PILOTAGE.md`), dossier), maj: (await $.fs.stat(`${dossier}/PILOTAGE.md`)).mtimeMs } }
        catch (err) { plan = { chantier: dossier.split('/').pop() ?? '', dossier, cap: '', sessions: [], fronts: [], atoi: [], attente: [], fait: [], livre: '', erreur: `PILOTAGE.md illisible : ${String(err)}` } }
        const partage = `${dossier}/.pilotage`
        const autres: Voisine[] = []
        try {
          await $.fs.write(`${partage}/.gitignore`, '*\n')
          await $.fs.write(`${partage}/${moi}.json`, JSON.stringify({
            id: moi, maj: maintenant, demande, auTravail: !demandeFinie, quoi: filSession.at(-1)?.quoi ?? '',
            agents: enCours().map(a => ({ nom: a.nom, statut: a.statut, debut: a.debut })),
          }))
          for (const x of await $.fs.list(partage)) {
            if (!x.name.endsWith('.json') || x.name === `${moi}.json`) continue
            try {
              const v = JSON.parse(await $.fs.read(`${partage}/${x.name}`))
              if (maintenant - (v.maj ?? 0) < VIEUX_MS) autres.push({ ...v, agents: v.agents ?? [] })
            } catch { /* being written */ }
          }
        } catch { /* shared folder unavailable: this session only */ }
        voisines = autres
        // time log: the nearest temps.csv, in the project or above (every 30 s)
        if (tour % 6 === 1) {
          passe = 0
          for (let d = dossier; segments(d) > 2; d = parent(d)) {
            try { passe = tempsPasse(await $.fs.read(`${d}/temps.csv`)); break } catch { /* higher up */ }
          }
        }
      }
      $.ui.invalidate('ui.render')
    }

    await rafraichir()
    arreter?.cancel()
    arreter = $.clock.every(5000, () => { void rafraichir() })
    if (dossier) ouvrir()
    return next(e)
  })

  on('command.run', { command: 'panneau-pilotage' }, async $ => {
    if (!dossier) await relancer?.()
    await afficher($)
    return { text: dossier ? 'Panneau Pilotage ouvert.' : 'Panneau ouvert ; aucun chantier lié à cette session pour l’instant.' }
  })

  // each agent's mission (its brief), the agent's actions, messages received
  on('tool.call', async ($, e, next) => {
    const x = e as any
    if (x.tool === 'Agent' && x.description) {
      missions.set(x.description, String(x.prompt ?? '').slice(0, 4000))
      lances.set(x.description, await $.clock.now())
      if (fichierMissions) {
        // merge with the file: an agent launched before the reread must not erase the saved briefs
        let garde: Record<string, unknown> = {}
        try { garde = JSON.parse(await $.fs.read(fichierMissions)) } catch { /* nothing saved */ }
        const m = { ...garde, ...Object.fromEntries([...missions].map(([d, mission]) => [d, { mission, lance: lances.get(d) ?? 0 }])) }
        void $.fs.write(fichierMissions, JSON.stringify(m)).catch(() => {})
      }
    }
    if (x.agentId) actions.set(x.agentId, (actions.get(x.agentId) ?? 0) + 1)
    if (!x.agentId && x.tool === 'Bash' && (x.run_in_background ?? x.input?.run_in_background)) {
      const quoi = String(x.description ?? x.input?.description ?? 'Commande')
      const quand = await $.clock.now()
      fond = [...fond, { id: 'b' + (x.tool_use_id ?? x.toolUseId ?? quand), quoi, debut: quand, commande: String(x.command ?? x.input?.command ?? '') }]
      $.ui.invalidate('ui.render')
    }
    // a question asked by the session (end-of-turn box, multiple-choice question) goes straight to « À toi »
    if (!x.agentId) {
      const q = /wrap_up$/.test(String(x.tool)) ? x.ask ?? x.input?.ask
        : x.tool === 'AskUserQuestion' ? (x.questions ?? x.input?.questions)?.[0]?.question : undefined
      if (q) { questionLive = String(q); $.ui.invalidate('ui.render') }
      // the AskUserQuestion picker hands back control once the answer is given
      if (q && x.tool === 'AskUserQuestion') {
        const r = await next(e)
        questionLive = ''
        $.ui.invalidate('ui.render')
        return r
      }
    }
    // visible feed: the last twelve actions, without the noise of the app's tools
    if (!String(x.tool).startsWith('mcp__ccd_')) {
      const pas = { t: await $.clock.now(), quoi: action(String(x.tool), x) }
      if (x.agentId) fils.set(x.agentId, [...(fils.get(x.agentId) ?? []), pas].slice(-12))
      else { filSession = [...filSession, pas].slice(-12); $.ui.invalidate('ui.render') }
    }
    // the session touches a PILOTAGE.md: it is its project
    const chemin = String(x.file_path ?? '')
    if (!x.agentId && !parDossier && ['Read', 'Write', 'Edit'].includes(x.tool) && chemin.endsWith('/PILOTAGE.md')) {
      const d = parent(chemin)
      if (d !== dossier) {
        dossier = d
        chercher = false
        if (fichierLien) { try { await $.fs.write(fichierLien, d) } catch { /* link lost on reload */ } }
        // project found along the way: the panel opens by itself, no command needed
        ouvrirPanneau?.()
      }
    }
    if (x.tool === 'SendMessage') {
      const cible = [...suivis.values()].find(a => a.id === x.to || (a.nomCourt && a.nomCourt === x.to))
      if (cible) cible.messages++
    }
    return next(e)
  })

  // the session's current request (the typed text), for its detail view
  // a message typed by the person (not a command like /btw, not a hidden message) answers the current question
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command) { questionLive = ''; relit = true; atoiAvant = null; relitDepuis = await $.clock.now(); $.ui.invalidate('ui.render') }
    // the method travels with the mod: every message on a project, the first one otherwise
    if (!e.isMeta && !e.command && (plan || !rappele)) {
      rappele = true
      return next({ ...e, context: [...(e.context ?? []), rappel(plan?.dossier)] })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // any session turn (typed message, notification, message from another session) puts it to work
    if (!e.agentId) { demandeFinie = false; debutTour = await $.clock.now() }
    // a notification or a system message starts with a tag: it is not a request
    if (!e.agentId && e.text && !e.text.trimStart().startsWith('<')) demande = e.text.slice(0, 300)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) finDeTour()
    return next(e)
  })

  // end of the session's turn: what is still running in the background, except agents already tracked
  on('classic.Stop', async ($, e, next) => {
    const x = e as any
    const t = await $.clock.now()
    fond = ((x.background_tasks ?? []) as any[])
      .filter(b => b.type !== 'subagent' && !FINIS.includes(String(b.status)))
      .map(b => {
        const quoi = String(b.description || b.command || b.type).split('\n')[0]
        // the start seen at launch is kept (same id, or same description)
        const vu = fond.find(f => f.id === String(b.id)) ?? fond.find(f => f.quoi === quoi)
        return { id: String(b.id), quoi, debut: vu?.debut ?? t, commande: String(b.command || vu?.commande || '') }
      })
    finDeTour()
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const x = e as any
    const a = suivis.get(x.agent_id)
    if (a) {
      const tout = String(x.last_assistant_message ?? '')
      Object.assign(a, extraire(tout))
      a.dernier = tout.slice(0, 600)
      finisAEcrire = true
    }
    return next(e)
  })

  // panel closed or reopened: the band redraws at once
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!plan || e.props.hasSurvey) return next(e)
    // panel already shown: the band is removed
    const panneauVu = (await $.ui.panes()).some(x => x.id === PANE && x.isShown && x.isPlaced)
    if (panneauVu) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e) as any
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text dimColor>{resume(plan, enCours().length, questionLive && demandeFinie ? 1 : 0)}</Text>
        <Button key="ouvrir" label="Ouvrir" onPress={() => afficher($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const t = maintenant
    // from the Done list, an agent's « Retour » leads back there
    const voir = (id: string) => () => { retour = choisi === 'fait' && id ? 'fait' : ''; choisi = id; $.ui.invalidate('ui.render') }
    const copier = (texte: string) => () => { void $.ui.copy({ text: texte, surface: e.surface }) }
    const titre = (s: string) => <Text dimColor size="caption" weight="medium">{s.toUpperCase()}</Text>
    const bloc = (nom: string, contenu: any) => <Box flexDirection="column" gap="xs">{titre(nom)}{contenu}</Box>
    const depuis = (debut: number, fin = t) => Math.max(1, min(fin - debut))
    const retourAccueil = <Button plain onPress={voir('')}>← Retour</Button>
    // « ? »: prepares a /btw question about this point in the input box, without interrupting Claude
    const question = (sujet: string) => (
      <Button plain onPress={() => { void $.prompt.fill({ text: `/btw Question sur « ${sujet} » : ` }) }}>?</Button>
    )
    const avecQuestion = (contenu: any, sujet: string) => (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">{contenu}{question(sujet)}</Box>
    )

    if (!plan) {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Text weight="medium">Aucun chantier lié à cette session</Text>
          <Text dimColor>Il s’affiche dès que la session ouvre ou crée son PILOTAGE.md.</Text>
        </Box>
      )
    }
    const p = plan
    const miens = [...suivis.values()]
    const { points: aToi, bloquants, arret, attend } = lireAToi(p.atoi, questionLive, demandeFinie, miens.every(x => x.fin))
    ;({ relit, avant: atoiAvant } = relecture(relit, atoiAvant, JSON.stringify(p.atoi)))
    // an agent belongs to one front only: exact name, then letter (« F »), then shared words
    const nomsFronts = p.fronts.map(f => f.cells[0]).filter(Boolean)
    const egal = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
    const codeAgent = (x: Agent) => codeFront(x.nom) || codeFront(x.front + ' : ')
    const frontDe = (x: Agent) => nomsFronts.find(f => egal(f, x.front))
      ?? (codeAgent(x) ? nomsFronts.find(f => codeFront(f) === codeAgent(x)) : undefined)
      ?? nomsFronts.find(f => appartient(x, f))

    // action feed: most recent on top, with their age
    const fil = (pas: Pas[] = []) => pas.length === 0
      ? [<Text key="vide" dimColor>Aucune action vue pour l’instant.</Text>]
      : [...pas].reverse().slice(0, 12).map((x, k) => (
        <Box key={'f' + k} flexDirection="row" justifyContent="space-between" gap="sm">
          <Text>{x.quoi}</Text>
          <Text dimColor size="footnote">{`${depuis(x.t)} min`}</Text>
        </Box>
      ))

    // detail of the session itself
    if (choisi === 'ici') {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          {retourAccueil}
          {avecQuestion(<Text weight="semibold">Chef · cette session</Text>, 'le chef (cette session)')}
          {titre(demandeFinie ? 'Dernière demande' : 'Demande en cours')}
          <Text>{demande || 'Pas encore de demande vue depuis le chargement du panneau.'}</Text>
          {titre('Ce qu’elle a fait')}
          {fil(filSession)}
        </Box>
      )
    }

    // numbered list: each point in bold, its detail below
    const points = (lignes: string[], parPoint = false) => lignes.map((l, k) => {
      const [quoi, detail] = couper(l, ' : ')
      const tete = <Text weight="medium">{k + 1}. {quoi}</Text>
      return (
        <Box key={k + l} flexDirection="column">
          {parPoint ? avecQuestion(tete, quoi) : tete}
          {detail && <Text dimColor size="footnote">{uneLigne(detail, 160)}</Text>}
        </Box>
      )
    })
    if (choisi === 'atoi' || choisi === 'attente' || choisi.startsWith('sujet:')) {
      const vue = choisi === 'atoi' ? groupesAToi(aToi, bloquants)
        : choisi === 'attente' ? sujets(p.attente)
        : sujets(p.attente).filter(g => g.nom === choisi.slice(6))
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          {retourAccueil}
          <Text dimColor size="footnote">{choisi === 'atoi'
            ? phraseAToi(bloquants.size, arret, relit)
            : PROCHAIN}</Text>
          {vue.map(g => (
            <Box key={g.nom} flexDirection="column" gap="xs" borderStyle="round" borderDimColor padding="sm">
              {choisi === 'atoi'
                ? (g.nom === 'À répondre maintenant' ? <Text color="warning" size="caption" weight="medium">{g.nom.toUpperCase()}</Text> : titre(g.nom))
                : avecQuestion(titre(`${g.nom} · ${g.taches.length}`), `${g.nom} (prochain lot)`)}
              {points(g.taches, choisi === 'atoi')}
            </Box>
          ))}
        </Box>
      )
    }

    // card for a front the panel has not seen running: what the plan says
    if (choisi.startsWith('front:')) {
      const f = p.fronts.find(x => x.cells[0] === choisi.slice(6))
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          {retourAccueil}
          {avecQuestion(<Text weight="medium">{f?.cells[0] ?? 'Front'}</Text>, f?.cells[0] ?? 'ce front')}
          <Text dimColor size="footnote">{f?.cells[3] || 'état non indiqué'}</Text>
          {titre('Fichiers')}
          <Text>{f?.cells[1] || '—'}</Text>
          {titre('Qui s’en charge')}
          <Text>{f?.cells[2] || '—'}</Text>
          <Text dimColor size="footnote">Son agent a tourné avant l’ouverture du panneau : pas de détail gardé.</Text>
        </Box>
      )
    }

    // another session of the project: what it shares, not more
    if (choisi.startsWith('session:')) {
      const s = voisines.find(v => v.id === choisi.slice(8))
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          {retourAccueil}
          <Text weight="semibold">{nomSession(s?.demande)}</Text>
          <Text dimColor size="footnote">{s ? etatVoisine(s, t) : 'terminée'}</Text>
          {s?.demande && titre('Sa demande')}
          {s?.demande && <Text>{s.demande}</Text>}
          {s?.quoi && titre('Sa dernière action')}
          {s?.quoi && <Text>{s.quoi}</Text>}
          {!!s?.agents.length && titre(`Ses agents · ${s.agents.length}`)}
          {s?.agents.map(x => <Text key={x.nom}>{nomCourt(x.nom)} · {depuis(x.debut)} min</Text>)}
        </Box>
      )
    }

    // agent of another session on the project: what this session knows about it
    if (choisi.startsWith('autre:')) {
      const [, id, ...reste] = choisi.split(':')
      const nom = reste.join(':')
      const x = voisines.find(v => v.id === id)?.agents.find(y => y.nom === nom)
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          {retourAccueil}
          <Text weight="medium">{nom}</Text>
          <Text dimColor size="footnote">{x ? `${etatAgent(x).texte} · ${depuis(x.debut)} min` : 'terminé'}</Text>
          <Text dimColor size="footnote">Il tourne dans une autre session : son détail est dans cette session.</Text>
        </Box>
      )
    }

    // agent detail (level 2): its mission, where it stands or what it returned, why
    const a = suivis.get(choisi)
    if (a) {
      const front = p.fronts.find(f => f.cells[0] === frontDe(a))
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          <Button plain onPress={voir(retour)}>← Retour</Button>
          <Box flexDirection="column" gap="xs">
            {avecQuestion(<Text weight="semibold">{nomCourt(a.nom)}</Text>, `l'agent ${nomCourt(a.nom)}`)}
            <Text dimColor size="footnote">{[codeAgent(a) ? `Agent ${codeAgent(a)}` : '', etatAgent(a).texte, `${depuis(a.debut, a.fin)} min`, a.outils ? `${a.outils} action${a.outils > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</Text>
          </Box>
          {front && bloc('En charge de', morceaux(front.cells[0].replace(CODE_FRONT, '')).map((m, k) => <Text key={k}>• {m}</Text>))}
          {front?.cells[1] && bloc('Fichiers', morceaux(front.cells[1]).map((m, k) => <Text key={k} dimColor>• {m}</Text>))}
          {bloc('Sa mission', <Text>{mission(a.mission) || 'Brief non capté (agent lancé avant cette version du panneau).'}</Text>)}
          {etapes(a.mission).length > 0 && bloc('Ses étapes', [
            ...etapes(a.mission).map((x, k) => etapesDetail && etapes(a.mission).some(aDuDetail)
              // full: one card per step, the number on the title line, the text indented below
              ? <Box key={k} flexDirection="column" gap="xs" paddingX="md" paddingY="sm" borderStyle="round" borderDimColor>
                  <Box flexDirection="row" gap="sm">
                    <Text color="suggestion" weight="semibold">{k + 1}</Text>
                    <Text weight="semibold">{detailEtape(x).titre}</Text>
                  </Box>
                  {detailEtape(x).lignes.map((l, j) => (
                    <Box key={j} flexDirection="row" gap="xs" paddingLeft="lg">
                      {l.puce && <Text color="suggestion" size="footnote">•</Text>}
                      <Text size="footnote" dimColor={l.technique}>{l.texte}</Text>
                    </Box>
                  ))}
                </Box>
              : <Box key={k} flexDirection="column">
                  <Box flexDirection="row" gap="sm">
                    <Text color="suggestion" weight="semibold">{k + 1}</Text>
                    <Text weight="medium">{etapeCourte(x).titre}</Text>
                  </Box>
                  {etapeCourte(x).ligne && <Box paddingLeft="lg"><Text dimColor size="footnote">{etapeCourte(x).ligne}</Text></Box>}
                </Box>),
            etapes(a.mission).some(aDuDetail) && <Box key="d" flexDirection="row"><Button variant="secondary" onPress={() => { etapesDetail = !etapesDetail; $.ui.invalidate('ui.render') }}>{etapesDetail ? 'Résumer' : 'Tout le détail'}</Button></Box>,
          ])}
          {a.fin && bloc('Ce qu’il a rendu', <Text color={a.statut === 'failed' ? 'error' : undefined}>{a.resume || unePhrase(a.dernier, 300) || 'Pas de compte rendu.'}</Text>)}
          {a.pourquoi && bloc('Pourquoi', <Text>{a.pourquoi}</Text>)}
          {bloc(a.fin ? 'Ses dernières actions' : 'Où il en est', fil((a.fil ?? []).slice(-3)))}
          {a.statut === 'failed' && <Button onPress={copier(a.dernier ?? a.nom)}>Copier l’erreur</Button>}
          <Text dimColor size="footnote">Tout le détail : menu ⋯ › Tâches en arrière-plan</Text>
        </Box>
      )
    }

    const horsPlan = miens.filter(x => !frontDe(x))

    // one line: dot and name on the left, time on the right
    const ligne = (cle: string, point: string, couleur: string, nom: string, droite: string, opts: { onPress?: () => void; teinte?: string; charge?: boolean } = {}) => {
      // the dot stays outside the button: a button clears its text color
      const nomTexte = [<Text key="n" color={opts.teinte}>{uneLigne(nom, 34)}</Text>, ...(opts.charge ? [<Text key="c" color="warning"> · chargé</Text>] : [])]
      return (
        <Box key={cle} flexDirection="row" justifyContent="space-between" paddingY="xs" gap="sm">
          <Box flexDirection="row">
            <Text color={couleur}>{point} </Text>
            {opts.onPress ? <Button key={cle + '-b'} plain onPress={opts.onPress}>{nomTexte}</Button> : <Text>{nomTexte}</Text>}
          </Box>
          <Text dimColor={!opts.teinte} color={opts.teinte} size="footnote">{droite}</Text>
        </Box>
      )
    }

    const ligneAgent = (x: Agent, complet = false) => {
      const ec = ((x.fin ?? t) - x.debut) / 60000
      const est = x.fin ? null : estimer(x.type, ec, durees)
      const teinte = x.statut === 'failed' ? 'error' : est?.long ? 'warning' : undefined
      const droite = x.fin
        ? etatAgent(x).texte
        : est?.long ? `long · ${Math.round(ec)} min`
        : `${Math.max(1, Math.round(ec))} min`
      const action = nomCourt(x.front ? x.nom.replace(new RegExp('^' + x.front.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*', 'i'), '') : x.nom)
      return ligne(x.id, etatAgent(x).point, etatAgent(x).couleur, complet && x.front && !/^front\s+\S+$/i.test(x.front) ? `${x.front} · ${action}` : action, droite, { onPress: voir(x.id), teinte, charge: x.messages > 3 })
    }

    const carte = (enfants: any, accent?: string) => (
      <Box flexDirection="column" padding="md" gap="xs" borderStyle="round" borderColor={accent} borderDimColor={!accent}>{enfants}</Box>
    )

    const bandeau = bandeauAToi({ points: aToi.length, attend, reflechit: relit || !demandeFinie, auTravail: enCours().length + fond.length })

    // team sorted by state: each line is an agent (a task), or a plan front with no agent seen
    type Element = { etat: Etat['groupe']; ordre: number; el: any }
    const elements: Element[] = []
    for (const f of p.fronts) {
      const vivants = miens.filter(x => frontDe(x) === f.cells[0])
      for (const x of vivants) elements.push({ etat: etatAgent(x).groupe, ordre: x.fin ?? x.debut, el: ligneAgent(x) })
      if (vivants.length) continue
      const etat = (f.cells[3] ?? '').split(',').pop()!.trim()
      const vu = etatDuPlan(etat)
      // a running front without an agent is the session itself: the chef's line already says so
      if (vu === ETATS.enCours && sansAgent(f.cells[2])) continue
      elements.push({ etat: vu.groupe, ordre: 0,
        el: ligne(f.cells[0], vu.point, vu.couleur, f.cells[0], etat, { onPress: voir('front:' + f.cells[0]) }) })
    }
    for (const x of horsPlan) elements.push({ etat: etatAgent(x).groupe, ordre: x.fin ?? x.debut, el: ligneAgent(x, true) })
    const ligneFond = (f: typeof fond[number], n = 1) => ligne('fond' + f.id, '⚙', 'suggestion', nomTache(f.quoi) + (n > 1 ? ` ×${n}` : ''), `${depuis(f.debut)} min`, { onPress: voir('tache:' + f.id + '\u0000' + f.quoi) })
    // card for a lead task: what it is for, since when, its command
    // the id may change at end of turn (the engine's id replaces the launch one): fall back on the name
    const [tacheId, tacheQuoi] = choisi.startsWith('tache:') ? choisi.slice(6).split('\u0000') : []
    const tache = tacheId ? fond.find(f => f.id === tacheId) ?? fond.find(f => f.quoi === tacheQuoi) : undefined
    if (tache) {
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          {retourAccueil}
          <Box flexDirection="column" gap="xs">
            {avecQuestion(<Text weight="semibold">{nomTache(tache.quoi)}</Text>, `la tâche ${nomTache(tache.quoi)}`)}
            <Text dimColor size="footnote">Tâche du chef · depuis {duree(depuis(tache.debut))}</Text>
          </Box>
          {bloc('À quoi elle sert', <Text>{aQuoiSert(tache.quoi, tache.commande)}</Text>)}
          <Text dimColor size="footnote">Ce n’est pas un agent : c’est le chef qui l’a lancée et qui la suit.</Text>
          {tache.commande && bloc('Commande', <Text dimColor size="footnote">{uneLigne(tache.commande, 300)}</Text>)}
        </Box>
      )
    }
    // the lead's tasks (commands, servers, watches): their own group, so they are not confused with agents
    const parNom = new Map<string, typeof fond>()
    for (const f of [...fond].sort((a, b) => a.debut - b.debut)) parNom.set(nomTache(f.quoi), [...(parNom.get(nomTache(f.quoi)) ?? []), f])
    const tachesChef = [...parNom.values()].map(l => ({ etat: 'cours' as const, ordre: l[0].debut, el: ligneFond(l[0], l.length) }))

    const actifs = elements.filter(e => e.etat === 'cours').sort((a, b) => a.ordre - b.ordre)
    const aLancer = elements.filter(e => e.etat === 'lancer')
    const faits = elements.filter(e => e.etat === 'fait').sort((a, b) => b.ordre - a.ordre)
    // without agents, what is done comes from the plan's « Fait » lines
    const lotsFaits = p.fait.map((l, k) => ({ etat: 'fait' as const, ordre: 0, el: ligne('lot' + k, ETATS.rendu.point, ETATS.rendu.couleur, l, '') }))
    const faitsVus = faits.length ? faits : lotsFaits
    const groupe = (nom: string, liste: Element[], max = 99) => liste.length > 0 && (
      <Box flexDirection="column" paddingLeft="lg" paddingTop="xs">
        {titre(`${nom} · ${liste.length}`)}
        {liste.slice(0, max).map(e => e.el)}
        {liste.length > max && ligne('plus-' + nom, ' ', 'inactive', `+ ${liste.length - max} autre${liste.length - max > 1 ? 's' : ''}`, '', { onPress: voir('fait') })}
      </Box>
    )

    // everything done, on clicking « + N autres »
    if (choisi === 'fait') {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          {retourAccueil}
          {titre(`Fait · ${faitsVus.length}`)}
          {faitsVus.map(e => e.el)}
          {faits.length > 0 && p.fait.length > 0 && titre(`Lots · ${p.fait.length}`)}
          {faits.length > 0 && p.fait.map(l => <Text key={l} size="footnote">{l}</Text>)}
        </Box>
      )
    }

    const derniere = filSession.at(-1)
    const [livrable, etape] = couper(p.cap, ', ')
    const [numero, action] = couper(etape, ' : ')
    const ligne2 = [action, passe > 0 ? `${duree(passe)} passées` : ''].filter(Boolean).join(' · ')
    const groupes = sujets(p.attente)
    // the next batch takes the remaining screen space, so the overview fits without scrolling
    const avant = [actifs.length, tachesChef.length, aLancer.length, Math.min(faitsVus.length, 3) + (faitsVus.length > 3 ? 1 : 0)]
    const nSujets = sujetsVisibles({
      rangees: e.viewport?.rows,
      groupes: avant.filter(n => n > 0),
      fil: !demandeFinie && filSession.length > 0,
      ligne2: !!ligne2,
      autres: voisines.reduce((n, s) => n + 1 + s.agents.length, 0) + (p.sessions.length > 1 ? 1 + p.sessions.length : 0),
      sujets: groupes.length,
    })
    if (e.viewport?.rows && e.viewport.rows !== ecranVu && fichierEcran) {
      ecranVu = e.viewport.rows
      void $.fs.write(fichierEcran, JSON.stringify({ rangees: ecranVu, colonnes: e.viewport.columns, surface: e.surface })).catch(() => {})
    }
    return (
      <Box flexDirection="column" gap="md" padding="sm">
        <Text weight="semibold" size="title">{p.chantier}</Text>
        {sousTitre(p, t) && <Text dimColor size="footnote">{sousTitre(p, t)}</Text>}
        {p.erreur && <Text color="error">{p.erreur}</Text>}
        {p.erreur && <Button onPress={copier(p.erreur)}>Copier</Button>}

        {bandeau.couleur
          ? <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX="md" paddingY="sm" borderStyle="round" borderColor={bandeau.couleur}>
              <Text weight="semibold" color={bandeau.couleur}>{bandeau.texte}</Text>
              <Button plain onPress={voir('atoi')}>Voir</Button>
            </Box>
          : <Box paddingX="md" paddingY="sm" borderStyle="round" borderDimColor>
              <Text dimColor>{bandeau.texte}</Text>
            </Box>}

        {carte([
          <Text key="t" dimColor size="caption" weight="medium">OBJECTIF</Text>,
          <Text key="c" weight="semibold">{uneLigne([livrable || 'Objectif à écrire dans PILOTAGE.md', numero].filter(Boolean).join(' · '), 40)}</Text>,
          ...(ligne2 ? [<Text key="e" dimColor size="footnote">{ligne2}</Text>] : []),
        ])}

        <Box flexDirection="column" gap="xs">
          {titre('Équipe')}
          {ligne('ici', '◆', 'claude', 'Chef · cette session', etatChef(demandeFinie, aToi.length, fond.length), { onPress: voir('ici') })}
          {!demandeFinie && <Box paddingLeft="lg"><Text dimColor size="footnote">{uneLigne(`↳ ${derniere && derniere.t >= debutTour ? derniere.quoi : 'réfléchit'}`, 48)}</Text></Box>}
          {groupe('Agents en cours', actifs)}
          {groupe('Tâches du chef', tachesChef)}
          {groupe('À lancer', aLancer)}
          {groupe('Fait', faitsVus, 3)}
          {elements.length === 0 && <Box paddingLeft="lg"><Text dimColor>Aucun agent : la session travaille seule</Text></Box>}
          {voisines.map(s => (
            <Box key={s.id} flexDirection="column">
              {ligne(s.id, '▣', 'inactive', nomSession(s.demande), etatVoisine(s, t), { onPress: voir(`session:${s.id}`) })}
              <Box flexDirection="column" paddingLeft="lg">
                {s.agents.map(x => ligne(s.id + x.nom, ETATS.enCours.point, ETATS.enCours.couleur, x.nom.replace(PREFIXE_TYPE, '') || x.nom, `${depuis(x.debut)} min`, { onPress: voir(`autre:${s.id}:${x.nom}`) }))}
              </Box>
            </Box>
          ))}
        </Box>

        {p.sessions.length > 1 && <Box flexDirection="column" gap="xs">
          {titre('Sessions prévues')}
          {p.sessions.map(s => ligne(s.cells[0], etatDuPlan(s.cells[3]).point, etatDuPlan(s.cells[3]).couleur, s.cells[0], s.cells[3] ?? ''))}
        </Box>}

        {p.attente.length > 0 && <Box flexDirection="column" gap="xs">
          {titre(`Prochain lot · ${p.attente.length}`)}
          <Text dimColor size="footnote">{PROCHAIN}</Text>
          {groupes.slice(0, nSujets).map(g => ligne('su' + g.nom, '·', 'inactive', uneLigne(g.nom), String(g.taches.length), { onPress: voir('sujet:' + g.nom) }))}
          {groupes.length > nSujets && ligne('su+', ' ', 'inactive', `+ ${groupes.length - nSujets} autre${groupes.length - nSujets > 1 ? 's' : ''}`, '', { onPress: voir('attente') })}
        </Box>}
      </Box>
    )
  })

}
