export type Agent = {
  id: string
  nom: string
  nomCourt?: string
  front: string
  type: string
  statut: string
  debut: number
  departVu: boolean
  fin?: number
  outils: number
  messages: number
  mission?: string
  dernier?: string
  resume?: string
  pourquoi?: string
  fil?: Pas[]
}

// a visible action: what was done, when
export type Pas = { t: number; quoi: string }

export type Ligne = { cells: string[] }

export type Plan = {
  chantier: string
  dossier: string
  cap: string
  sessions: Ligne[]
  fronts: Ligne[]
  atoi: string[]
  attente: string[]
  fait: string[]
  // « Livré : <date> » line: the project is finished
  livre: string
  // when PILOTAGE.md was last written (ms)
  maj?: number
  erreur?: string
}

export type Voisine = {
  id: string
  maj: number
  agents: { nom: string; statut: string; debut: number }[]
  // what this session is doing, for the other sessions of the project
  demande?: string
  // null: not known (reload during a turn)
  auTravail?: boolean | null
  quoi?: string
}
