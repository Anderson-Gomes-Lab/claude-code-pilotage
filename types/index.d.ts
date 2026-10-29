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

// une action visible : ce qui a été fait, quand
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
  erreur?: string
}

export type Voisine = {
  id: string
  maj: number
  agents: { nom: string; statut: string; debut: number }[]
}
