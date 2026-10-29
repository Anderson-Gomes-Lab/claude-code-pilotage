import type { Register } from 'claude-code'

import type { Agent, Ligne, Plan, Voisine, Pas } from '../types'

// Panneau Pilotage : lit le PILOTAGE.md du chantier, suit les agents de la session,
// partage leur état avec les autres sessions du chantier (dossier .pilotage/),
// et compare chaque durée aux durées réelles passées (~/.claude/pilotage/durees.json).

const PANE = 'pilotage'
const TYPES = ['recherche', 'contrôle', 'construction', 'correction']
const MOTS: [string, string][] = [
  ['contrôle', 'contrôle'], ['relecture', 'contrôle'], ['relis', 'contrôle'],
  ['recherche', 'recherche'], ['analyse', 'recherche'], ['enquête', 'recherche'],
  ['corrig', 'correction'], ['correction', 'correction'], ['appliquer', 'correction'],
  ['construi', 'construction'], ['lot ', 'construction'], ['rythme', 'construction'],
]
const FINIS = ['completed', 'failed', 'killed']
const PAUSE_MS = 120_000

type Duree = { type: string; minutes: number; outils: number }

const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/'
const segments = (p: string) => p.split('/').filter(Boolean).length
const VIEUX_MS = 30 * 60_000 // une session muette depuis 30 min ne s'affiche plus

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
    .filter(l => !/^rien\b/i.test(l))

// Coupe une phrase du plan en deux lignes lisibles : avant et après le premier séparateur.
export function couper(texte: string, sep: string): [string, string] {
  const i = texte.indexOf(sep)
  const maj = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  return i < 0 ? [maj(texte.trim()), ''] : [maj(texte.slice(0, i).trim()), maj(texte.slice(i + sep.length).trim())]
}

// Le bandeau au-dessus de la saisie : l'essentiel du panneau en une ligne.
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

// Temps passé du chantier : somme de la colonne duree_min d'un registre temps.csv (lignes vides ignorées).
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

// 45 min, 2 h 30, 12 h : pas de décimale inutile
export function duree(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return h >= 10 || r === 0 ? `${Math.round(m / 60)} h` : `${h} h ${String(r).padStart(2, '0')}`
}

// Une action d'outil dite en clair, pour le fil : « a lu register.tsx », « a lancé les tests »
export function action(outil: string, x: Record<string, unknown>): string {
  const court = (v: unknown, n = 60) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
  const fichier = (v: unknown) => String(v ?? '').split('/').pop() || 'un fichier'
  switch (outil) {
    case 'Read': return `a lu ${fichier(x.file_path)}`
    case 'Write': return `a écrit ${fichier(x.file_path)}`
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `a modifié ${fichier(x.file_path ?? x.notebook_path)}`
    // jamais la commande elle-même : elle peut contenir un secret
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

// Fin de compte rendu d'un agent : « En une phrase : … » et « Pourquoi : … » (skill pilotage)
export function extraire(texte: string): { resume: string; pourquoi: string } {
  const net = texte.replace(/\*\*/g, '')
  // la dernière ligne qui commence par l'étiquette : le résumé est en fin de compte rendu
  const lire = (motif: RegExp) => ([...net.matchAll(motif)].pop()?.[1] ?? '').trim().replace(/^[«"]\s*|\s*[»"]$/g, '')
  return { resume: lire(/^\s*(?:[-*]\s*)?En une phrase\s*:\s*(.+)$/gim), pourquoi: lire(/^\s*(?:[-*]\s*)?Pourquoi\s*:\s*(.+)$/gim) }
}

// Première phrase d'un brief, pour dire la mission en une ligne
export function unePhrase(texte = '', n = 160): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  // fin de phrase : un mot d'au moins deux lettres puis . ! ? (pas « S.A. »)
  const p = t.match(/^(.+?[a-zà-ÿ0-9)»"']{2}[.!?])(\s|$)/)?.[1] ?? t
  return p.length > n ? p.slice(0, n - 1) + '…' : p
}

// Un agent appartient à un front si son front porte le même nom, ou si leurs noms
// partagent au moins deux mots significatifs (« Front B : bandeau cookies » ↔ « B. Bandeau cookies pleine largeur »)
export function appartient(agent: { front: string; nom: string }, front: string): boolean {
  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (norm(agent.front) === norm(front)) return true
  const mots = (x: string) => new Set(norm(x).split(/[^a-z0-9.]+/).filter(m => m.length >= 4 && m !== 'front'))
  const a = mots(agent.nom), f = mots(front)
  return [...a].filter(m => f.has(m)).length >= 2
}

// Lettre d'un front : « F. Laiton… » ou « Front F : laiton… » → « F »
export function codeFront(x = ''): string {
  return x.match(/^(?:[Ff]ront\s+)?([A-Z]\d{0,2})\s*[.:·)]\s/)?.[1] ?? ''
}

// Une énumération coupée en morceaux (virgule, point-virgule, « + »), sans couper dans les parenthèses
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
  return out.map(m => m.trim()).filter(Boolean).map(m => m.charAt(0).toUpperCase() + m.slice(1))
}

// Étapes d'un brief : ses lignes numérotées (« 1. … »), dans l'ordre
// La mission lisible : la ligne « Mission : … » du brief, sinon sa première phrase
export function mission(brief = ''): string {
  // une phrase seulement : le chemin, la commande ou l'adresse qui suivent sont pour l'agent
  const m = brief.match(/^\s*(?:Mission|Objectif)\s*:\s*(.+)$/im)?.[1]?.trim()
  const t = unePhrase(sansMarques(m || brief.replace(/^\s*(?:Mission|Objectif)\s*:\s*/i, '')), 240)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function etapes(brief = ''): string[] {
  const out: string[] = []
  let dans = false
  for (const l of brief.split('\n')) {
    const n = l.match(/^\s*\d+[.)]\s+(.+)/)
    if (n) { out.push(n[1].trim()); dans = true; continue }
    // la suite d'une étape (lignes en retrait) lui reste attachée ; le reste la ferme
    if (dans && /^\s+\S/.test(l)) out[out.length - 1] += '\n' + l.trim().replace(/^[-•*]\s*/, '• ')
    else dans = false
  }
  return out.slice(0, 12)
}

// Une étape coupée à son premier « : » hors guillemets : ce qui précède (le thème) et le reste
function couperEtape(x = ''): { avant: string; corps: string } {
  const [brute, ...suite] = x.split('\n')
  // un thème en gras (« **Titre** … ») est le titre, quoi qu'il suive
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

// Le gras et le code Markdown ne s'affichent pas dans le panneau : on enlève leurs marques
const sansMarques = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '').replace(/`/g, '')

const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// Une étape résumée : un titre court (le thème, jusqu'à la première virgule) et une ligne (la première phrase qui suit)
export function etapeCourte(x = '', n = 80): { titre: string; ligne: string } {
  const { avant, corps } = couperEtape(x)
  if (!avant) return { titre: uneLigne(phrases(corps)[0] ?? '', 60), ligne: '' }
  const phrase = (phrases(corps)[0] ?? '').replace(/^«\s*/, '').replace(/\s*»\s*\.?$/, '').replace(/^([^«]*?)\s*»/, '$1')
  return { titre: uneLigne(avant.split(',')[0].trim(), 40), ligne: uneLigne(majuscule(phrase), n) }
}

// Une étape en entier : le thème complet, puis une ligne par phrase (un seul découpage, rien de perdu ni de répété),
// les puces à part, les consignes techniques (commande, chemin, fichier) en petit
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

// Le détail apporte-t-il quelque chose au résumé ? Sinon, pas de bouton pour le déplier
export function aDuDetail(x = ''): boolean {
  const c = etapeCourte(x), d = detailEtape(x)
  return d.titre !== c.titre || d.lignes.length > (c.ligne ? 1 : 0) || (d.lignes.length === 1 && d.lignes[0].texte !== c.ligne)
}

// Une étape en lignes courtes : une phrase par ligne, les puces à part
export function phrases(texte = ''): string[] {
  // pas de coupe après une initiale (« M. Durand », « S.A. »)
  return texte.split('\n').flatMap(l => l.split(/(?<=[.!?…])(?<!(?:^|[^\p{L}])[A-ZÀ-Ý]\.)\s+(?=[«A-ZÀ-Ý•])/u)).map(x => x.trim()).filter(Boolean)
}

// Ce que fait une tâche du chef, en clair
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

// Une ligne au plus : coupée proprement
export function uneLigne(texte: string, n = 48): string {
  const t = texte.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '').replace(/[\s·,;:–-]+$/, '') + '…' : t
}

// Nom affiché d'un agent : sans « Front · type : » ni « Front A : », première lettre en capitale
export function nomCourt(nom: string): string {
  const t = nom.replace(/^.+?·\s*\p{L}+\s*:\s*/iu, '').replace(/^front\s+\S+\s*:\s*/i, '').trim() || nom
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Hauteurs relevées sur une capture du panneau (unités = pixels d'écran Retina) :
// haut jusqu'au chef 585, groupe 62 + 64 par ligne, prochain lot 116 + 80 par ligne, bas 60.
// Une rangée de la surface ≈ 36 unités : mesurée sur une capture (43 rangées pour un panneau de 1570 unités).
export const UNITE_RANGEE = 36
export function sujetsVisibles(x: { rangees?: number; groupes: number[]; fil: boolean; ligne2: boolean; autres: number; sujets: number }): number {
  if (!x.rangees) return Math.min(3, x.sujets)
  const pris = 585 + (x.fil ? 40 : 0) - (x.ligne2 ? 0 : 45) + x.groupes.reduce((t, n) => t + 62 + 64 * n, 0) + (x.autres ? 80 + 64 * x.autres : 0) + 116 + 60
  const place = Math.floor((x.rangees * UNITE_RANGEE - pris) / 80)
  if (place >= x.sujets) return x.sujets
  return Math.max(1, place - 1) // une ligne gardée pour « + N autres »
}

const PROCHAIN = 'Pour de nouveaux agents, après ce lot.'

// Une ligne « Toi : … » est pour la personne, pas pour un agent
const TOI = /^toi\s*:\s*/i
const pourToi = (l: string) => TOI.test(l)

// Prochain lot rangé par sujet : « Sujet : tâche » ; sans sujet, la tâche va dans « À ranger »
export function sujets(attente: string[]): { nom: string; taches: string[] }[] {
  const m = new Map<string, string[]>()
  for (const l of attente) {
    // un sujet est un nom court (quatre mots au plus, sans parenthèse ni guillemet) ; sinon le deux-points est dans la phrase
    const m2 = l.match(/^([^:()«»"]{1,40}?)\s*:\s+(.+)$/)?.filter((_, i) => i < 3)
    if (m2 && m2[1].trim().split(/\s+/).length > 4) m2.length = 0
    const [nom, tache] = m2?.length ? couper(`${m2[1]}\u0000${m2[2]}`, '\u0000') : ['À ranger', l]
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
    chantier: couper(titre ?? dossier.split('/').pop() ?? 'chantier', '\u0000')[0],
    dossier,
    cap: texte.match(/^Cap\s*:\s*(.+)$/m)?.[1]?.trim()
      ?? cle('fronts').match(/\(([^)]+)\)/)?.[1]?.replace(/^./, c => c.toUpperCase()) ?? '',
    sessions: tableau(sections[cle('sessions')] ?? ''),
    fronts: tableau(sections[cle('fronts')] ?? ''),
    atoi: [...liste(sections[cle('à toi')] ?? ''), ...attente.filter(pourToi).map(l => couper(l.replace(TOI, ''), '\u0000')[0])],
    attente: attente.filter(l => !pourToi(l)),
    fait: liste(sections[cle('fait')] ?? ''),
  }
}

const mediane = (v: number[]) => v[Math.floor((v.length - 1) / 2)]
const centile80 = (v: number[]) => v[Math.floor(0.8 * (v.length - 1))]

// Fourchette habituelle d'après l'historique ; au-delà de la médiane, on ne garde
// que les agents passés qui ont duré au moins autant (durées à queue longue).
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

const min = (ms: number) => Math.max(0, Math.round(ms / 60000))

export const register: Register = on => {
  // Données en mémoire du module : elles repartent à zéro à chaque rechargement du mod.
  const suivis = new Map<string, Agent>()
  const missions = new Map<string, string>()
  let durees: Duree[] = []
  let dossier = ''
  let fichierDurees = ''
  let moi = ''
  let choisi = ''
  let retour = ''
  let etapesDetail = false // fiche d'agent : étapes en entier plutôt que titre + une ligne
  let plan: Plan | null = null
  let voisines: Voisine[] = []
  const fils = new Map<string, Pas[]>() // fil d'actions par agent, dès sa première action
  let filSession: Pas[] = []
  let demande = ''
  let relit = false // un message de la personne vient d'arriver : « À toi » est peut-être déjà répondu
  let atoiAvant: string | null = null
  let relitDepuis = 0, debutTour = 0 // un message tapé pendant un tour attend le suivant : seule la fin de ce tour-là le compte comme lu
  let questionLive = '' // dernière question posée par la session, jusqu'à la réponse
  let demandeFinie = true // la dernière demande tapée dans cette session
  // travail en arrière-plan qui n'est pas un agent (commande, surveillance, workflow) : la liste du moteur à chaque fin de tour
  let fond: { id: string; quoi: string; debut: number; commande?: string }[] = []
  let restaure = false
  let finisAEcrire = false // compte rendu arrivé : la copie gardée doit suivre
  let passe = 0 // minutes inscrites au registre temps.csv du chantier
  let maintenant = 0
  let fichierLien = ''
  let fichierFinis = '' // agents finis de cette session, gardés hors du chantier
  let ecranVu = 0 // dernière hauteur vue, notée pour régler l'estimation
  let fichierEcran = ''
  let fichierMissions = '' // briefs des agents de cette session, relus après un rechargement du mod
  let chercher = true
  let arreter: { cancel: () => void } | null = null
  const lances = new Map<string, number>()
  const actions = new Map<string, number>() // actions par agent, comptées dès le départ
  let parDossier = false // chantier trouvé par le dossier de travail : il prime
  let relancer: (() => Promise<void>) | null = null
  let ouvrirPanneau: (() => void) | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'panneau-pilotage', description: 'Ouvrir le panneau Pilotage du chantier' })
    const cwd = await $.session.cwd()
    moi = (await $.session.id()).slice(0, 8)
    const maison = (await $.env.get("HOME")) ?? ''
    fichierDurees = maison ? `${maison}/.claude/pilotage/durees.json` : ''
    try { durees = fichierDurees ? JSON.parse(await $.fs.read(fichierDurees)) : [] } catch { durees = [] }

    // le chantier de CETTE session : PILOTAGE.md au-dessus du dossier de travail,
    // sinon celui que la session a ouvert ou écrit (lien gardé dans ~/.claude/pilotage/sessions/).
    // Jamais le chantier d'une autre session : sans lien, le panneau le dit.
    const lien = () => maison ? `${maison}/.claude/pilotage/sessions/${moi}.txt` : ''
    fichierLien = lien()
    const finisDe = () => maison ? `${maison}/.claude/pilotage/finis/${moi}.json` : ''
    fichierFinis = finisDe()
    fichierMissions = fichierFinis.replace('/finis/', '/missions/')
    fichierEcran = maison ? `${maison}/.claude/pilotage/ecran.json` : ''
    const ouvrir = () => { void $.ui.open({ id: PANE, title: 'Pilotage' }).then(() => $.ui.invalidate('ui.render')) }
    const trouver = async () => {
      const avant = dossier
      for (let d = cwd; segments(d) > 2 && !dossier; d = parent(d)) {
        try { await $.fs.read(`${d}/PILOTAGE.md`); dossier = d; parDossier = true } catch { /* plus haut */ }
      }
      if (!dossier && fichierLien) {
        try { dossier = (await $.fs.read(fichierLien)).trim() } catch { /* pas encore de lien */ }
      }
      // chantier découvert en cours de route (fichier créé par un agent ou un script) : ouverture seule
      if (dossier && dossier !== avant) ouvrir()
    }
    relancer = async () => { chercher = false; await trouver() }
    ouvrirPanneau = ouvrir

    let tour = 0
    const rafraichir = async () => {
      maintenant = await $.clock.now()
      // /clear donne une nouvelle session sans session.start : on repart de zéro
      const id = (await $.session.id()).slice(0, 8)
      if (id !== moi) {
        moi = id
        fichierLien = lien()
        fichierFinis = finisDe()
        fichierMissions = fichierFinis.replace('/finis/', '/missions/')
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
      // agents finis gardés : relus avant la liste, pour ne pas être écrasés par une copie vide
      if (!restaure && fichierFinis) {
        restaure = true
        try {
          for (const a of JSON.parse(await $.fs.read(fichierFinis)) as Agent[]) {
            suivis.set(a.id, a)
            if (a.fil) fils.set(a.id, a.fil)
          }
        } catch { /* première fois */ }
        try {
          const m = JSON.parse(await $.fs.read(fichierMissions)) as Record<string, { mission: string; lance: number }>
          for (const [d, v] of Object.entries(m)) {
            if (!missions.has(d)) missions.set(d, v.mission)
            if (!lances.has(d)) lances.set(d, v.lance)
          }
        } catch { /* aucun brief gardé */ }
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
          // seulement un agent dont on a vu le départ ; le fichier est relu juste avant (sessions concurrentes)
          if (a.departVu && fichierDurees) {
            try { durees = JSON.parse(await $.fs.read(fichierDurees)) } catch { /* on garde la copie */ }
            durees.push({ type: a.type, minutes: Math.round((a.fin - a.debut) / 6000) / 10, outils: a.outils })
            try { await $.fs.write(fichierDurees, JSON.stringify(durees)) } catch { /* l'historique attendra */ }
          }
        }
      }
      if ((finiNeuf || finisAEcrire) && fichierFinis) {
        finisAEcrire = false
        const finis = [...suivis.values()].filter(a => a.fin).slice(-20)
        try { await $.fs.write(fichierFinis, JSON.stringify(finis)) } catch { /* gardés en mémoire seulement */ }
      }
      if (dossier) {
        try { plan = lirePlan(await $.fs.read(`${dossier}/PILOTAGE.md`), dossier) }
        catch (err) { plan = { chantier: dossier.split('/').pop() ?? '', dossier, cap: '', sessions: [], fronts: [], atoi: [], attente: [], fait: [], erreur: `PILOTAGE.md illisible : ${String(err)}` } }
        const partage = `${dossier}/.pilotage`
        const autres: Voisine[] = []
        try {
          {
            await $.fs.write(`${partage}/.gitignore`, '*\n')
            await $.fs.write(`${partage}/${moi}.json`, JSON.stringify({
              id: moi, maj: maintenant,
              agents: [...suivis.values()].filter(a => !a.fin).map(a => ({ nom: a.nom, statut: a.statut, debut: a.debut })),
            }))
          }
          for (const x of await $.fs.list(partage)) {
            if (!x.name.endsWith('.json') || x.name === `${moi}.json`) continue
            try {
              const v = JSON.parse(await $.fs.read(`${partage}/${x.name}`))
              if (maintenant - (v.maj ?? 0) < VIEUX_MS) autres.push({ ...v, agents: v.agents ?? [] })
            } catch { /* en cours d'écriture */ }
          }
        } catch { /* dossier partagé indisponible : cette session seule */ }
        voisines = autres
        // registre de temps : le temps.csv le plus proche, dans le chantier ou au-dessus (toutes les 30 s)
        if (tour % 6 === 1) {
          passe = 0
          for (let d = dossier; segments(d) > 2; d = parent(d)) {
            try { passe = tempsPasse(await $.fs.read(`${d}/temps.csv`)); break } catch { /* plus haut */ }
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
    await $.ui.open({ id: PANE, title: 'Pilotage' })
    $.ui.invalidate('ui.render')
    return { text: dossier ? 'Panneau Pilotage ouvert.' : 'Panneau ouvert ; aucun chantier lié à cette session pour l’instant.' }
  })

  // mission de chaque agent (son brief), actions de l'agent, messages reçus
  on('tool.call', async ($, e, next) => {
    const x = e as any
    if (x.tool === 'Agent' && x.description) {
      missions.set(x.description, String(x.prompt ?? '').slice(0, 4000))
      lances.set(x.description, await $.clock.now())
      if (fichierMissions) {
        // fusion avec le fichier : un agent lancé avant la relecture ne doit pas effacer les briefs gardés
        let garde: Record<string, unknown> = {}
        try { garde = JSON.parse(await $.fs.read(fichierMissions)) } catch { /* rien de gardé */ }
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
    // une question posée par la session (case de fin de tour, question à choix) va d'office dans « À toi »
    if (!x.agentId) {
      const q = /wrap_up$/.test(String(x.tool)) ? x.ask ?? x.input?.ask
        : x.tool === 'AskUserQuestion' ? (x.questions ?? x.input?.questions)?.[0]?.question : undefined
      if (q) { questionLive = String(q); $.ui.invalidate('ui.render') }
      // le sélecteur de AskUserQuestion rend la main une fois la réponse donnée
      if (q && x.tool === 'AskUserQuestion') {
        const r = await next(e)
        questionLive = ''
        $.ui.invalidate('ui.render')
        return r
      }
    }
    // fil visible : les douze dernières actions, sans le bruit des outils de l'appli
    if (!String(x.tool).startsWith('mcp__ccd_')) {
      const pas = { t: await $.clock.now(), quoi: action(String(x.tool), x) }
      if (x.agentId) fils.set(x.agentId, [...(fils.get(x.agentId) ?? []), pas].slice(-12))
      else { filSession = [...filSession, pas].slice(-12); $.ui.invalidate('ui.render') }
    }
    // la session touche un PILOTAGE.md : c'est son chantier
    const chemin = String(x.file_path ?? '')
    if (!x.agentId && !parDossier && ['Read', 'Write', 'Edit'].includes(x.tool) && chemin.endsWith('/PILOTAGE.md')) {
      const d = parent(chemin)
      if (d !== dossier) {
        dossier = d
        chercher = false
        if (fichierLien) { try { await $.fs.write(fichierLien, d) } catch { /* lien perdu au rechargement */ } }
        // chantier trouvé en cours de route : le panneau s'ouvre seul, sans commande
        ouvrirPanneau?.()
      }
    }
    if (x.tool === 'SendMessage') {
      const cible = [...suivis.values()].find(a => a.id === x.to || (a.nomCourt && a.nomCourt === x.to))
      if (cible) cible.messages++
    }
    return next(e)
  })

  // la demande en cours de la session (le texte tapé), pour sa vue détail
  // un message tapé par la personne (ni commande comme /btw, ni message caché) répond à la question en cours
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command) { questionLive = ''; relit = true; atoiAvant = null; relitDepuis = await $.clock.now(); $.ui.invalidate('ui.render') }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    // tout tour de la session (message tapé, notification, message d'une autre session) la met au travail
    if (!e.agentId) { demandeFinie = false; debutTour = await $.clock.now() }
    if (!e.agentId && e.text) demande = e.text.slice(0, 300)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) { demandeFinie = true; if (debutTour >= relitDepuis) relit = false }
    return next(e)
  })

  // fin de tour de la session : ce qui tourne encore en arrière-plan, sauf les agents déjà suivis
  on('classic.Stop', async ($, e, next) => {
    const x = e as any
    const t = await $.clock.now()
    fond = ((x.background_tasks ?? []) as any[])
      .filter(b => b.type !== 'subagent' && !/^(completed|failed|killed)$/.test(String(b.status)))
      .map(b => {
        const quoi = String(b.description || b.command || b.type).split('\n')[0]
        // le départ vu au lancement est gardé (même id, ou même description)
        const vu = fond.find(f => f.id === String(b.id)) ?? fond.find(f => f.quoi === quoi)
        return { id: String(b.id), quoi, debut: vu?.debut ?? t, commande: String(b.command || vu?.commande || '') }
      })
    demandeFinie = true
    if (debutTour >= relitDepuis) relit = false
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

  // panneau fermé ou rouvert : le bandeau se redessine aussitôt
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!plan || e.props.hasSurvey) return next(e)
    // panneau déjà affiché : le bandeau se retire
    const panneauVu = (await $.ui.panes()).some(x => x.id === PANE && x.isShown && x.isPlaced)
    if (panneauVu) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e) as any
    const enCours = [...suivis.values()].filter(a => !a.fin).length
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text dimColor>{resume(plan, enCours, questionLive && demandeFinie ? 1 : 0)}</Text>
        <Button key="ouvrir" label="Ouvrir" onPress={async () => { await $.ui.open({ id: PANE, title: 'Pilotage' }); $.ui.invalidate('ui.render') }} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const t = maintenant
    // depuis la liste Fait, « Retour » d'un agent y ramène
    const voir = (id: string) => () => { retour = choisi === 'fait' && id ? 'fait' : ''; choisi = id; $.ui.invalidate('ui.render') }
    const copier = (texte: string) => () => { void $.ui.copy({ text: texte, surface: e.surface }) }
    const titre = (s: string) => <Text dimColor size="caption" weight="medium">{s.toUpperCase()}</Text>
    // « ? » : prépare dans la zone de saisie une question /btw sur ce point, sans interrompre Claude
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
    // ce qui bloque la suite d'abord : la question posée en fin de tour, puis les lignes « ! » du plan
    const miens = [...suivis.values()]
    // ce qui bloque la suite : la question posée en fin de tour (fondue dans le point du plan qui en parle) et les lignes « ! »
    const pointsToi = p.atoi.map(l => ({ t: l.replace(/^!\s*/, ''), bloque: /^!/.test(l) }))
    // la question de fin de tour ne vaut que tour fini : dès que Claude se remet au travail, elle n'attend plus
    if (questionLive && demandeFinie) {
      const meme = pointsToi.find(x => appartient({ front: '', nom: x.t }, questionLive))
      if (meme) meme.bloque = true
      else pointsToi.unshift({ t: `Répondre : ${questionLive}`, bloque: true })
    }
    const aToi = [...pointsToi.filter(x => x.bloque), ...pointsToi.filter(x => !x.bloque)].map(x => x.t)
    // après un message de la personne, les points d'avant ne valent plus tant que Claude n'a pas relu « À toi »
    // (il le réécrit, ou finit son tour)
    const cleAToi = JSON.stringify(p.atoi)
    if (relit && atoiAvant === null) atoiAvant = cleAToi
    else if (relit && atoiAvant !== cleAToi) relit = false
    const bloquants = new Set(pointsToi.filter(x => x.bloque).map(x => x.t))
    // plus rien ne tourne : la suite dépend de toi
    // (les tâches de fond n'en décident pas : serveurs et surveillances tournent sans fin)
    const arret = demandeFinie && miens.every(x => x.fin)
    // un agent n'appartient qu'à un seul front : nom exact, puis lettre (« F »), puis mots communs
    const nomsFronts = p.fronts.map(f => f.cells[0]).filter(Boolean)
    const egal = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()
    const codeAgent = (x: Agent) => codeFront(x.nom) || codeFront(x.front + ' : ')
    const frontDe = (x: Agent) => nomsFronts.find(f => egal(f, x.front))
      ?? (codeAgent(x) ? nomsFronts.find(f => codeFront(f) === codeAgent(x)) : undefined)
      ?? nomsFronts.find(f => appartient(x, f))

    // fil d'actions : les plus récentes en haut, avec leur âge
    const fil = (pas: Pas[] = []) => pas.length === 0
      ? [<Text key="vide" dimColor>Aucune action vue pour l’instant.</Text>]
      : [...pas].reverse().slice(0, 12).map((x, k) => (
        <Box key={'f' + k} flexDirection="row" justifyContent="space-between" gap="sm">
          <Text>{x.quoi}</Text>
          <Text dimColor size="footnote">{`${Math.max(1, min(t - x.t))} min`}</Text>
        </Box>
      ))

    // détail de la session elle-même
    if (choisi === 'ici') {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
          <Text weight="medium">Cette session</Text>
          {titre(demandeFinie ? 'Dernière demande' : 'Demande en cours')}
          <Text>{demande || 'Pas encore de demande vue depuis le chargement du panneau.'}</Text>
          {titre('Ce qu’elle a fait')}
          {fil(filSession)}
        </Box>
      )
    }

    // liste numérotée : chaque point en gras, son détail en dessous
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
      const vue = choisi === 'atoi' ? [
          { nom: 'À répondre maintenant', taches: aToi.filter(x => bloquants.has(x)) },
          { nom: bloquants.size ? 'Quand tu peux' : `À toi · ${aToi.length}`, taches: aToi.filter(x => !bloquants.has(x)) },
        ].filter(g => g.taches.length > 0)
        : choisi === 'attente' ? sujets(p.attente)
        : sujets(p.attente).filter(g => g.nom === choisi.slice(6))
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
          <Text dimColor size="footnote">{choisi === 'atoi'
            ? (relit ? 'Claude réfléchit : ces points peuvent changer.' : arret ? 'Claude attend ta réponse pour continuer.' : 'Tu peux répondre tout de suite : ton message attend son tour, Claude ne s’arrête pas.')
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

    // fiche d'un front que le panneau n'a pas vu tourner : ce que dit le plan
    if (choisi.startsWith('front:')) {
      const f = p.fronts.find(x => x.cells[0] === choisi.slice(6))
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
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

    // agent d'une autre session du chantier : ce que cette session en sait
    if (choisi.startsWith('autre:')) {
      const [, id, ...reste] = choisi.split(':')
      const nom = reste.join(':')
      const x = voisines.find(v => v.id === id)?.agents.find(y => y.nom === nom)
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
          <Text weight="medium">{nom}</Text>
          <Text dimColor size="footnote">{x ? `${statutVoisin(x.statut)} · ${Math.max(1, min(t - x.debut))} min` : 'terminé'}</Text>
          <Text dimColor size="footnote">Il tourne dans une autre session : son détail est dans cette session.</Text>
        </Box>
      )
    }

    // détail d'un agent (niveau 2) : sa mission, où il en est ou ce qu'il a rendu, pourquoi
    const a = suivis.get(choisi)
    if (a) {
      const front = p.fronts.find(f => f.cells[0] === frontDe(a))
      const bloc = (nom: string, contenu: any) => <Box flexDirection="column" gap="xs">{titre(nom)}{contenu}</Box>
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          <Button plain onPress={voir(retour)}>← Retour</Button>
          <Box flexDirection="column" gap="xs">
            {avecQuestion(<Text weight="semibold">{nomCourt(a.nom)}</Text>, `l'agent ${nomCourt(a.nom)}`)}
            <Text dimColor size="footnote">{[codeAgent(a) ? `Agent ${codeAgent(a)}` : '', statutTexte(a), `${Math.max(1, min((a.fin ?? t) - a.debut))} min`, a.outils ? `${a.outils} action${a.outils > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</Text>
          </Box>
          {front && bloc('En charge de', morceaux(front.cells[0].replace(/^(?:[Ff]ront\s+)?[A-Z]\d{0,2}\s*[.:·)]\s+/, '')).map((m, k) => <Text key={k}>• {m}</Text>))}
          {front?.cells[1] && bloc('Fichiers', morceaux(front.cells[1]).map((m, k) => <Text key={k} dimColor>• {m}</Text>))}
          {bloc('Sa mission', <Text>{mission(a.mission) || 'Brief non capté (agent lancé avant cette version du panneau).'}</Text>)}
          {etapes(a.mission).length > 0 && bloc('Ses étapes', [
            ...etapes(a.mission).map((x, k) => etapesDetail && etapes(a.mission).some(aDuDetail)
              // en entier : une carte par étape, le numéro sur la ligne du titre, le texte en retrait dessous
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

    // agents rangés par front du plan ; un agent fini reste visible quinze minutes
    // tous les agents de la session : le groupe Fait n'en montre que trois
    const visibles = miens
    const horsPlan = visibles.filter(x => !frontDe(x))


    // une ligne : pastille et nom à gauche, temps à droite
    const ligne = (cle: string, point: string, couleur: string, nom: string, droite: string, opts: { onPress?: () => void; teinte?: string; charge?: boolean } = {}) => {
      // la pastille reste hors du bouton : un bouton efface la couleur de son texte
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
        ? statutTexte(x)
        : est?.long ? `long · ${Math.round(ec)} min`
        : `${Math.max(1, Math.round(ec))} min`
      const action = nomCourt(x.front ? x.nom.replace(new RegExp('^' + x.front.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*', 'i'), '') : x.nom)
      return ligne(x.id, pastille(x), couleurAgent(x), complet && x.front && !/^front\s+\S+$/i.test(x.front) ? `${x.front} · ${action}` : action, droite, { onPress: voir(x.id), teinte, charge: x.messages > 3 })
    }

    const carte = (enfants: any, accent?: string) => (
      <Box flexDirection="column" padding="md" gap="xs" borderStyle="round" borderColor={accent} borderDimColor={!accent}>{enfants}</Box>
    )

    const auTravail = miens.filter(x => !x.fin).length + fond.length
    // plus rien ne tourne : la suite dépend de toi

    // équipe rangée par état : chaque ligne est un agent (une tâche), ou un front du plan sans agent vu
    type Element = { etat: 'cours' | 'lancer' | 'fait'; ordre: number; el: any }
    const elements: Element[] = []
    for (const f of p.fronts) {
      const vivants = visibles.filter(x => frontDe(x) === f.cells[0])
      for (const x of vivants) elements.push({ etat: x.fin ? 'fait' : 'cours', ordre: x.fin ?? x.debut, el: ligneAgent(x) })
      if (vivants.length) continue
      const etat = (f.cells[3] ?? '').split(',').pop()!.trim()
      const c = couleurPlan(etat)
      // front fini : la ligne du plan mène au dernier agent qui l'a tenu
      const dernierAgent = miens.filter(x => frontDe(x) === f.cells[0]).sort((x, y) => y.debut - x.debut)[0]
      elements.push({ etat: c === 'success' ? 'fait' : c === 'inactive' ? 'lancer' : 'cours', ordre: 0,
        el: ligne(f.cells[0], etatPlan(etat), c, f.cells[0], etat, { onPress: voir(dernierAgent ? dernierAgent.id : 'front:' + f.cells[0]) }) })
    }
    for (const x of horsPlan) elements.push({ etat: x.fin ? 'fait' : 'cours', ordre: x.fin ?? x.debut, el: ligneAgent(x, true) })
    const ligneFond = (f: typeof fond[number], n = 1) => ligne('fond' + f.id, '⚙', 'suggestion', nomTache(f.quoi) + (n > 1 ? ` ×${n}` : ''), `${Math.max(1, min(t - f.debut))} min`, { onPress: voir('tache:' + f.id + '\u0000' + f.quoi) })
    // fiche d'une tâche du chef : à quoi elle sert, depuis quand, sa commande
    // l'id peut changer en fin de tour (celui du moteur remplace celui du lancement) : on retombe sur le nom
    const [tacheId, tacheQuoi] = choisi.startsWith('tache:') ? choisi.slice(6).split('\u0000') : []
    const tache = tacheId ? fond.find(f => f.id === tacheId) ?? fond.find(f => f.quoi === tacheQuoi) : undefined
    if (tache) {
      const bloc = (nom: string, contenu: any) => <Box flexDirection="column" gap="xs">{titre(nom)}{contenu}</Box>
      return (
        <Box flexDirection="column" gap="lg" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
          <Box flexDirection="column" gap="xs">
            {avecQuestion(<Text weight="semibold">{nomTache(tache.quoi)}</Text>, `la tâche ${nomTache(tache.quoi)}`)}
            <Text dimColor size="footnote">Tâche du chef · depuis {duree(Math.max(1, min(t - tache.debut)))}</Text>
          </Box>
          {bloc('À quoi elle sert', <Text>{aQuoiSert(tache.quoi, tache.commande)}</Text>)}
          <Text dimColor size="footnote">Ce n’est pas un agent : c’est le chef qui l’a lancée et qui la suit.</Text>
          {tache.commande && bloc('Commande', <Text dimColor size="footnote">{uneLigne(tache.commande, 300)}</Text>)}
        </Box>
      )
    }
    // les tâches du chef (commandes, serveurs, surveillances) : leur propre groupe, pour ne pas les confondre avec les agents
    const parNom = new Map<string, typeof fond>()
    for (const f of [...fond].sort((a, b) => a.debut - b.debut)) parNom.set(nomTache(f.quoi), [...(parNom.get(nomTache(f.quoi)) ?? []), f])
    const tachesChef = [...parNom.values()].map(l => ({ etat: 'cours' as const, ordre: l[0].debut, el: ligneFond(l[0], l.length) }))

    const enCours = elements.filter(e => e.etat === 'cours').sort((a, b) => a.ordre - b.ordre)
    const aLancer = elements.filter(e => e.etat === 'lancer')
    const faits = elements.filter(e => e.etat === 'fait').sort((a, b) => b.ordre - a.ordre)
    const groupe = (nom: string, liste: Element[], max = 99) => liste.length > 0 && (
      <Box flexDirection="column" paddingLeft="lg" paddingTop="xs">
        {titre(`${nom} · ${liste.length}`)}
        {liste.slice(0, max).map(e => e.el)}
        {liste.length > max && ligne('plus-' + nom, ' ', 'inactive', `+ ${liste.length - max} autre${liste.length - max > 1 ? 's' : ''}`, '', { onPress: voir('fait') })}
      </Box>
    )

    // tout ce qui est fait, au clic sur « + N autres »
    if (choisi === 'fait') {
      return (
        <Box flexDirection="column" gap="sm" padding="sm">
          <Button plain onPress={voir('')}>← Retour</Button>
          {titre(`Fait · ${faits.length}`)}
          {faits.map(e => e.el)}
        </Box>
      )
    }

    const [livrable, etape] = couper(p.cap, ', ')
    const [numero, action] = couper(etape, ' : ')
    const ligne2 = [action, passe > 0 ? `${duree(passe)} passées` : ''].filter(Boolean).join(' · ')
    const groupes = sujets(p.attente)
    // le prochain lot prend la place qui reste à l'écran, pour que la vue d'ensemble tienne sans défiler
    const avant = [enCours.length, tachesChef.length, aLancer.length, Math.min(faits.length, 3) + (faits.length > 3 ? 1 : 0)]
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
        {p.erreur && <Text color="error">{p.erreur}</Text>}
        {p.erreur && <Button onPress={copier(p.erreur)}>Copier</Button>}

        {(relit || !demandeFinie) && aToi.length > 0
          ? <Box paddingX="md" paddingY="sm" borderStyle="round" borderDimColor>
              <Text dimColor>⏳ Claude réfléchit · rien à faire</Text>
            </Box>
          : aToi.length > 0
          ? <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingX="md" paddingY="sm" borderStyle="round" borderColor={arret ? 'warning' : 'suggestion'}>
              <Text weight="semibold" color={arret ? 'warning' : 'suggestion'}>☞ À toi · {aToi.length} point{aToi.length > 1 ? 's' : ''}{arret ? ' · Claude t’attend' : ''}</Text>
              <Button plain onPress={voir('atoi')}>Voir</Button>
            </Box>
          : <Box paddingX="md" paddingY="sm" borderStyle="round" borderDimColor>
              <Text dimColor>{auTravail > 0 ? '⏳ Claude travaille' : 'Rien à faire pour toi'}</Text>
            </Box>}

        {carte([
          <Text key="t" dimColor size="caption" weight="medium">OBJECTIF</Text>,
          <Text key="c" weight="semibold">{uneLigne([livrable || 'Objectif à écrire dans PILOTAGE.md', numero].filter(Boolean).join(' · '), 40)}</Text>,
          ...(ligne2 ? [<Text key="e" dimColor size="footnote">{ligne2}</Text>] : []),
        ])}

        <Box flexDirection="column" gap="xs">
          {titre('Équipe')}
          {ligne('ici', '◆', 'claude', 'Chef · cette session', !demandeFinie ? 'au travail' : aToi.length > 0 ? '' : fond.length > 0 ? 'attend ses tâches' : 'en pause', { onPress: voir('ici') })}
          {!demandeFinie && <Box paddingLeft="lg"><Text dimColor size="footnote">{uneLigne(`↳ ${filSession.length > 0 && filSession[filSession.length - 1].t >= debutTour ? filSession[filSession.length - 1].quoi : 'réfléchit'}`, 48)}</Text></Box>}
          {groupe('Agents en cours', enCours)}
          {groupe('Tâches du chef', tachesChef)}
          {groupe('À lancer', aLancer)}
          {groupe('Fait', faits, 3)}
          {elements.length === 0 && <Box paddingLeft="lg"><Text dimColor>Aucun agent : la session travaille seule</Text></Box>}
          {voisines.map(s => (
            <Box key={s.id} flexDirection="column">
              {ligne(s.id, '▣', 'inactive', `Session ${s.id}`, t - s.maj > PAUSE_MS ? 'en pause' : 'active')}
              <Box flexDirection="column" paddingLeft="lg">
                {s.agents.map(x => ligne(s.id + x.nom, '●', 'suggestion', x.nom.replace(/^.+?·\s*\p{L}+\s*:\s*/iu, '') || x.nom, `${Math.max(1, min(t - x.debut))} min`, { onPress: voir(`autre:${s.id}:${x.nom}`) }))}
              </Box>
            </Box>
          ))}
        </Box>

        {p.sessions.length > 1 && <Box flexDirection="column" gap="xs">
          {titre('Sessions prévues')}
          {p.sessions.map(s => ligne(s.cells[0], etatPlan(s.cells[3]), couleurPlan(s.cells[3]), s.cells[0], s.cells[3] ?? ''))}
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

function statutTexte(a: Agent): string {
  if (a.statut === 'failed') return 'échec'
  if (a.statut === 'killed') return 'arrêté'
  if (a.fin) return 'rendu'
  if (a.statut === 'waiting') return 'attend'
  return 'en cours'
}

function pastille(a: Agent): string {
  if (a.statut === 'failed' || a.statut === 'killed') return '✗'
  if (a.fin) return '✓'
  return '●'
}


function couleurAgent(a: Agent): string {
  if (a.statut === 'failed' || a.statut === 'killed') return 'error'
  if (a.fin) return 'success'
  if (a.statut === 'waiting') return 'warning'
  return 'suggestion'
}

function etatPlan(etat = ''): string {
  const e = etat.toLowerCase()
  if (e.startsWith('contrôl') || e.startsWith('rendu')) return '✓'
  if (e.startsWith('en cours')) return '●'
  return '○'
}

function couleurPlan(etat = ''): string {
  const e = etat.toLowerCase()
  if (e.startsWith('contrôl') || e.startsWith('rendu')) return 'success'
  if (e.startsWith('en cours')) return 'suggestion'
  if (e.startsWith('échec')) return 'error'
  return 'inactive'
}

function statutVoisin(statut: string): string {
  if (statut === 'failed') return 'échec'
  if (statut === 'waiting') return 'attend'
  if (['completed', 'killed'].includes(statut)) return 'rendu'
  return 'en cours'
}
