import { expect, test } from 'claude-code/testing'

import { action, appartient, nomCourt, duree, uneLigne, estimer, extraire, unePhrase, lireNom, lirePlan, sujets, resume, tempsPasse, couper, codeFront, etapes, morceaux, sujetsVisibles, mission, phrases, aQuoiSert, estVeille, etapeCourte, detailEtape, aDuDetail, sousTitre, nomSession, etatVoisine, rappel, attendToi, phraseAToi, lireAToi, relecture, bandeauAToi, groupesAToi, etatChef, etatAgent, etatDuPlan, lireApresTour, selonPlan, tachesDeFond, travaille, relever, lireVoisine, relitEncore, fondFrais } from './register'

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

test('the name gives the front and the type', () => {
  expect(lireNom('Héros · construction : refaire le haut')).toEqual({ front: 'Héros', type: 'construction' })
  expect(lireNom('Contrôle neutre de la v4').type).toBe('contrôle')
})

test('the plan is read', () => {
  const p = lirePlan(PLAN, '/x')
  expect(p.chantier).toBe('Site Test')
  expect(p.cap).toBe('Maquette v6, lot 2 sur 3')
  expect(p.fronts.map(f => f.cells[0])).toEqual(['Héros', 'Photos'])
  expect(p.atoi).toEqual(['Valider la v6'])
  expect(p.attente).toEqual(['Avis Google statiques'])
})

test('estimate: nothing under five measurements, a range afterwards, an alert beyond the 80th percentile', () => {
  const d = (m: number) => ({ type: 'recherche', minutes: m, outils: 10 })
  expect(estimer('recherche', 1, [d(2), d(3)])).toBe(null)
  const histo = [1, 2, 2, 3, 3, 4, 5, 6, 9, 20].map(d)
  const debut = estimer('recherche', 1, histo)!
  expect(debut.bas).toBe(3)
  expect(debut.haut).toBe(6)
  expect(debut.long).toBe(false)
  expect(estimer('recherche', 7, histo)!.long).toBe(true)
})

test('the contrôle type, with its accent, is recognized', () => {
  expect(lireNom('Contrôle · contrôle : relire le mod')).toEqual({ front: 'Contrôle', type: 'contrôle' })
})

test('above the median: range over the longer tasks only, nothing if fewer than three remain', () => {
  const d = (m: number) => ({ type: 'recherche', minutes: m, outils: 10 })
  const histo = [1, 2, 2, 3, 3, 4, 5, 6, 9, 20].map(d)
  const milieu = estimer('recherche', 4, histo)!
  expect(milieu.fourchette).toBe(true)
  expect(milieu.bas).toBe(6)
  const tard = estimer('recherche', 10, histo)!
  expect(tard.fourchette).toBe(false)
  expect(tard.long).toBe(true)
})

test('the cap splits into goal, step and action', () => {
  const [livrable, etape] = couper("mod Pilotage v1, lot 2 sur 2 : vérifier en vrai", ', ')
  expect(livrable).toBe('Mod Pilotage v1')
  expect(couper(etape, ' : ')).toEqual(['Lot 2 sur 2', 'Vérifier en vrai'])
  expect(couper('sans séparateur', ' : ')).toEqual(['Sans séparateur', ''])
})

test('the project name gets a capital letter', () => {
  expect(lirePlan('# Pilotage : panneau Pilotage\n', '/x').chantier).toBe('Panneau Pilotage')
})

test('the band fits on one line', () => {
  const plan = lirePlan('# Pilotage : X\nCap : site v1, lot 2 sur 3 : héros\n\n## À toi\n- valider\n', '/x')
  expect(resume(plan, 1)).toBe('Pilotage · Lot 2 sur 3 · 1 agent en cours · À toi : 1')
  expect(resume(plan, 0)).toBe('Pilotage · Lot 2 sur 3 · À toi : 1')
})

test('time spent sums the duree_min column, commas inside quotes included', () => {
  const csv = 'date,chantier,duree_min,description\n2026-10-07,a,39,"lu, écrit"\n2026-10-08,,,"non chiffré"\n2026-10-09,b,196,x\n'
  expect(tempsPasse(csv)).toBe(235)
  expect(tempsPasse('date,heures\n1,2\n')).toBe(0)
  expect(duree(45)).toBe('45 min')
  expect(duree(150)).toBe('2 h 30')
  expect(duree(235)).toBe('3 h 55')
  expect(duree(720)).toBe('12 h')
})

test('each action is said in plain words', () => {
  expect(action('Read', { file_path: '/a/b/register.tsx' })).toBe('a lu register.tsx')
  expect(action('Bash', { command: 'npm test', description: 'Lancer les tests' })).toBe('a lancé : Lancer les tests')
  expect(action('WebFetch', { url: 'https://code.claude.com/docs/x' })).toBe('a lu la page code.claude.com')
  expect(action('mcp__srv__get_thing', {})).toBe('a utilisé get_thing')
  expect(action('mcp__claude_ai_Gmail__search_threads', {})).toBe('a utilisé search_threads')
  expect(action('Bash', { command: 'curl -H "Authorization: Bearer x"' })).toBe('a lancé une commande')
  expect(action('SubagentHandback', { message: 'Fait.' })).toBe('a envoyé son compte rendu')
})

test('the report gives its summary and its reason', () => {
  const cr = 'Long rapport…\n\n**En une phrase :** six fiches écrites.\nPourquoi : « gardé le ton des avis, écarté les prix »'
  expect(extraire(cr)).toEqual({ resume: 'six fiches écrites.', pourquoi: 'gardé le ton des avis, écarté les prix' })
  expect(extraire('rien')).toEqual({ resume: '', pourquoi: '' })
})

test('the mission fits in one sentence', () => {
  expect(unePhrase('Écris six fiches. Ensuite relis.')).toBe('Écris six fiches.')
  expect(unePhrase('')).toBe('')
})

test('the plan reads the Fait section', () => {
  expect(lirePlan('# Pilotage : X\n\n## Fait\n- Accueil validé (28/10)\n', '/x').fait).toEqual(['Accueil validé (28/10)'])
})

test('v0.3 review: last line of the report, abbreviations', () => {
  expect(extraire('Voici pourquoi : le test cassait.\nEn une phrase : fait.\nPourquoi : écarté X.').pourquoi).toBe('écarté X.')
  expect(unePhrase('Refais la maquette S.A. Durand sans toucher au héros. Puis relis.')).toBe('Refais la maquette S.A. Durand sans toucher au héros.')
})

test('a badly named agent still finds its front', () => {
  expect(appartient({ front: '', nom: 'Front B : bandeau cookies pleine largeur' }, 'B. Bandeau cookies pleine largeur + choix gardé')).toBe(true)
  expect(appartient({ front: '', nom: 'Front A : héros comme en v5.1' }, 'A. Héros et lignes de bordure comme en v5.1')).toBe(true)
  expect(appartient({ front: '', nom: 'Front C : section des prix' }, 'D. Section zone compacte')).toBe(false)
  expect(appartient({ front: 'Héros', nom: 'Héros · construction : x' }, 'héros')).toBe(true)
})

test('one line at most', () => {
  expect(uneLigne('Regrouper les styles du pied (base.css et pied.css).')).toBe('Regrouper les styles du pied (base.css et…')
  expect(uneLigne('Court')).toBe('Court')
})

test('the displayed name loses its technical prefix', () => {
  expect(nomCourt('Front A : héros comme en v5.1')).toBe('Héros comme en v5.1')
  expect(nomCourt('Héros · construction : refaire le haut')).toBe('Refaire le haut')
})

test('next batch sorted by topic, « Toi : » waits there for later', () => {
  const p = lirePlan('# Pilotage : X\n## À toi\n- Valider\n## En attente\n- Toi : confirmer le prix\n- Zone : titre coupé\n- Zone: carte vide\n- Prix « à partir de » (salle de bain : 6 000 €) : à confirmer\n- Tester Safari\n', '/x')
  expect(p.atoi).toEqual(['Valider'])
  expect(sujets(p.attente)).toEqual([
    { nom: 'Zone', taches: ['Titre coupé', 'Carte vide'] },
    { nom: 'À ranger', taches: ['Prix « à partir de » (salle de bain : 6 000 €) : à confirmer', 'Tester Safari'] },
    { nom: 'Toi, plus tard', taches: ['Confirmer le prix'] },
  ])
})

test('the front letter links the plan and the agent name; the brief steps are its numbered lines', () => {
  expect(codeFront('F. Bordure dans chaque section')).toBe('F')
  expect(codeFront('Front E2 : estimateur sans vide')).toBe('E2')
  expect(codeFront('Intégration : tests')).toBe('')
  expect(etapes('Objectif : x\n1. Lire la charte\n2) Corriger les avis\n- fichier')).toEqual(['Lire la charte', 'Corriger les avis'])
})

test('a list splits into pieces, not inside parentheses', () => {
  expect(morceaux('Bordure dans chaque section (60-30-10), icônes des services, moitié droite')).toEqual(['Bordure dans chaque section (60-30-10)', 'Icônes des services', 'Moitié droite'])
  expect(morceaux('sections (index.html, pages.css) ; tests + chat')).toEqual(['Sections (index.html, pages.css)', 'Tests', 'Chat'])
})

test('the next batch fits in the panel height', () => {
  const base = { groupes: [3, 4], fil: false, ligne2: true, autres: 0, sujets: 8 }
  expect(sujetsVisibles({ ...base })).toBe(3)                  // unknown height: as before
  expect(sujetsVisibles({ ...base, rangees: 40 })).toBe(1)     // real screenshot: 1 topic + « + 7 autres »
  expect(sujetsVisibles({ ...base, rangees: 60 })).toBe(8)     // large screen: everything
  expect(sujetsVisibles({ ...base, rangees: 20 })).toBe(1)     // very small: at least one
})

test('the mission comes from the brief’s « Mission : » line', () => {
  expect(mission('Mission : vérifier les deux retouches du panneau.\nRelis le diff de ~/Code/x…')).toBe('Vérifier les deux retouches du panneau.')
  expect(mission('Objectif : intégrer le lot v2 (site d’un client) et remettre la batterie au vert. Dossier : /Users/a/b. Pour reconstruire : `python3 src/build.py`.')).toBe('Intégrer le lot v2 (site d’un client) et remettre la batterie au vert.')
  expect(mission('Relis le diff. Puis autre chose.')).toBe('Relis le diff.')
})

test('agent card: mission without label, steps in short lines', () => {
  expect(mission('Objectif : la zone prend une carte pâle.\n1. Accueil')).toBe('La zone prend une carte pâle.')
  const e = etapes('1. Libellé : remplace « 35 km » partout :\n   - accueil\n   - contact\n\n2. Tester.')
  expect(e).toEqual(['Libellé : remplace « 35 km » partout :\n• accueil\n• contact', 'Tester.'])
  expect(phrases('Accueil : la carte en fond. Les noms restent par-dessus.')).toEqual(['Accueil : la carte en fond.', 'Les noms restent par-dessus.'])
})

test('lead task explained in plain words', () => {
  expect(aQuoiSert('Servir le site construit en local', 'python3 -m http.server 8000')).toMatch(/navigateur/)
  expect(aQuoiSert('Autre', 'sleep 5')).toMatch(/arrière-plan/)
})

test('background tasks at end of turn: no agent, nothing finished, no watch; the start seen at launch is kept', () => {
  const taches = [
    { id: 'k1', type: 'bash', description: 'Lancer les tests\nsuite', status: 'running', command: 'npm test' },
    { id: 'k2', type: 'x', description: 'live updates for artifact 12', status: 'running' },
    { id: 'k3', type: 'bash', description: 'Fini', status: 'completed' },
    { id: 'k4', type: 'subagent', description: 'Agent', status: 'running' },
    { id: 'k6', type: 'monitor', description: 'Surveille', status: 'running' },
  ]
  expect(tachesDeFond(taches, [{ id: 'b1', quoi: 'Lancer les tests', debut: 5, vu: 5 }], 9))
    .toEqual([{ id: 'k1', quoi: 'Lancer les tests', debut: 5, vu: 9, commande: 'npm test' }])
  expect(tachesDeFond([{ id: 'k5', type: 'bash', command: 'sleep 5', status: 'running' }], [], 9))
    .toEqual([{ id: 'k5', quoi: 'sleep 5', debut: 9, vu: 9, commande: 'sleep 5' }])
})

test('a watch set when a page is published is not a task', () => {
  expect(estVeille('live updates for artifact 1234')).toBe(true)
  expect(estVeille('Live update for artifact 1234')).toBe(true)
  expect(estVeille('Servir le site construit en local')).toBe(false)
})

test('summarized step: a title and one line', () => {
  expect(etapeCourte('Libellé de la zone, la même formule partout : la zone exacte sera vue avec le client demain.\nRemplace « 35 km »'))
    .toEqual({ titre: 'Libellé de la zone', ligne: 'La zone exacte sera vue avec le client demain.' })
  expect(etapeCourte('Accueil : « sur la partie droite, la plus grande, je mettrais la carte de la région, zoomée sur le département, un peu pâle, en fond ». Les noms restent.').titre).toBe('Accueil')
  expect(etapeCourte('Tester sur Safari.')).toEqual({ titre: 'Tester sur Safari.', ligne: '' })
  expect(etapeCourte('Accueil « le client dit : la carte » à droite.')).toEqual({ titre: 'Accueil « le client dit : la carte » à droite.', ligne: '' })
  expect(etapeCourte('Accueil : « la map en fond », dit le client.').ligne).toBe('La map en fond, dit le client.')
})

test('step detail: nothing lost or repeated, bullets and technical instructions apart', () => {
  const x = 'Libellé : la zone sera vue demain.\nRemplace « 35 km » partout :\n• titre de la zone : « toute la région » ;\nFais `grep -rn "35 km" src/` pour n’en oublier aucun.'
  expect(detailEtape(x)).toEqual({ titre: 'Libellé', lignes: [
    { texte: 'La zone sera vue demain.', puce: false, technique: false },
    { texte: 'Remplace « 35 km » partout :', puce: false, technique: false },
    { texte: 'Titre de la zone : « toute la région »', puce: true, technique: false },
    { texte: 'Fais grep -rn "35 km" src/ pour n’en oublier aucun.', puce: false, technique: true },
  ] })
  expect(detailEtape('Accueil, bandeau du haut : mettre la carte. Ajouter le prix.').titre).toBe('Accueil, bandeau du haut')
  expect(detailEtape('Contact : M. Durand veut un bouton. Le mettre en haut.').lignes.map(l => l.texte)).toEqual(['M. Durand veut un bouton.', 'Le mettre en haut.'])
  expect(detailEtape('Ton : garder le ton et/ou le style. Vérifie à 25 km/h.').lignes.every(l => !l.technique)).toBe(true)
})

test('Markdown bold and parentheses in a step', () => {
  expect(etapeCourte('**Retirer les pages de ville** (décision du client : elles ne sont pas montrées demain).'))
    .toEqual({ titre: 'Retirer les pages de ville', ligne: '(décision du client : elles ne sont pas montrées demain).' })
  expect(etapeCourte('**DESIGN.md** : mets à jour la section.').titre).toBe('DESIGN.md')
  expect(etapeCourte('**`.preuve-note`** : tests/responsive.mjs donne 5 échecs.').titre).toBe('.preuve-note')
  expect(detailEtape('Note : a.\ntests/responsive.mjs donne 5 échecs.').lignes[1]).toEqual({ texte: 'tests/responsive.mjs donne 5 échecs.', puce: false, technique: true })
  expect(etapeCourte('**Libellé :** la zone sera vue demain.')).toEqual({ titre: 'Libellé', ligne: 'La zone sera vue demain.' })
  expect(etapeCourte('Contact : É. Dupont veut un bouton. Le mettre en haut.').ligne).toBe('É. Dupont veut un bouton.')
})

test('no detail to expand when the summary already says it all', () => {
  expect(aDuDetail('Lire les quatre exemples.')).toBe(false)
  expect(aDuDetail('Libellé : la zone sera vue demain.')).toBe(false)
  expect(aDuDetail('Libellé : la zone sera vue demain. Remplace « 35 km » partout.')).toBe(true)
  expect(aDuDetail('Libellé, partout : la zone sera vue demain.')).toBe(true)
})

test('a note in parentheses or a « nothing » line is not an item', () => {
  const p = lirePlan('# Pilotage : X\n\n## À toi\n- (nothing waiting; rule of 30/10: no feedback = approved)\n- Rien pour le moment\n- Valider le prix (avant lundi)\n- (urgent) Rappeler (lundi)\n', '/x')
  expect(p.atoi).toEqual(['Valider le prix (avant lundi)', '(urgent) Rappeler (lundi)'])
})

test('a finished project and an old flight plan are shown under the title', () => {
  const jour = 86400000
  expect(lirePlan('# Pilotage : X\nLivré : 12/11/2026\n', '/x').livre).toBe('12/11/2026')
  expect(sousTitre({ livre: '12/11/2026', maj: 0 }, 10 * jour)).toBe('Chantier livré · 12/11/2026')
  expect(sousTitre({ livre: '', maj: 1 }, 5 * jour)).toBe('Plan de vol mis à jour il y a 4 jours')
  expect(sousTitre({ livre: '', maj: 4 * jour }, 5 * jour)).toBe('')
  expect(sousTitre({ livre: '' }, 5 * jour)).toBe('')
})

test('another session is named by what it was asked, and its state is readable', () => {
  expect(nomSession('Refaire le pied de page. Et le chat.')).toBe('Refaire le pied de page')
  expect(nomSession('1. Relire le diff\n2. Lancer')).toBe('Relire le diff')
  expect(nomSession('Passe en v0.24.0 le mod')).toBe('Passe en v0.24.0 le mod')
  expect(nomSession('Corrige site.js puis relance')).toBe('Corrige site.js puis relance')
  expect(nomSession('Vois avec M. Durand le devis')).toBe('Vois avec M. Durand le devis')
  expect(nomSession('\nRefaire le pied')).toBe('Refaire le pied')
  expect(nomSession('...suite')).toBe('suite')
  expect(nomSession('')).toBe('Autre session')
  expect(nomSession()).toBe('Autre session')
  const agent = [{ nom: 'a', statut: 'running', debut: 0 }]
  expect(etatVoisine({ maj: 1000, auTravail: true, agents: [] }, 2000)).toBe('au travail')
  expect(etatVoisine({ maj: 1000, auTravail: false, agents: [] }, 2000)).toBe('attend')
  expect(etatVoisine({ maj: 1000, auTravail: false, agents: agent }, 2000)).toBe('au travail')
  expect(etatVoisine({ maj: 1000, agents: [] }, 2000)).toBe('au travail')
  expect(etatVoisine({ maj: 0, auTravail: true, agents: [] }, 100000000)).toBe('sans nouvelles')
})

test('the model is told how to use the pane, with or without a project', () => {
  expect(rappel('/x')).toContain('/x/PILOTAGE.md')
  expect(rappel('/x')).toContain('pilotage:method')
  expect(rappel()).toContain('pilotage:method')
  expect(rappel()).toContain('do nothing')
})

test('without a live agent, a plan row is never shown as running, whatever its Agent column says', () => {
  expect(selonPlan('en cours')).toBe(null)
  expect(selonPlan('lot 2, en cours')).toBe(null)
  expect(selonPlan('à lancer')?.etat.groupe).toBe('lancer')
  expect(selonPlan('rendu')?.etat.groupe).toBe('fait')
  expect(selonPlan('contrôlé, relu')).toEqual({ etat: selonPlan('rendu')!.etat, mot: 'contrôlé' })
  expect(selonPlan('échec')?.etat.groupe).toBe('lancer')
  expect(selonPlan('au travail')?.mot).toBe('')          // a word the pane cannot back is not repeated
  expect(selonPlan()?.etat.groupe).toBe('lancer')
})

test('Claude waits only on a blocking point', () => {
  expect(attendToi(0, true)).toBe(false)
  expect(attendToi(1, false)).toBe(false)
  expect(attendToi(1, true)).toBe(true)
  expect(phraseAToi(0, true, false)).toBe('Rien ne bloque : à faire quand tu peux.')
  expect(phraseAToi(1, true, false)).toBe('Claude attend ta réponse pour continuer.')
  expect(phraseAToi(0, true, true)).toBe('Claude réfléchit : ces points peuvent changer.')
})

test('« À toi »: blocking points first, marks removed', () => {
  const x = lireAToi(['Valider', '! Choisir la photo', 'Relire'], '', true, true)
  expect(x.points).toEqual(['Choisir la photo', 'Valider', 'Relire'])
  expect([...x.bloquants]).toEqual(['Choisir la photo'])
  expect(x.attend).toBe(true)
})

test('« À toi »: the end-of-turn question joins the plan point it mentions, or comes first', () => {
  const plan = ['Valider le prix', 'Choisir la photo de la zone']
  const meme = lireAToi(plan, 'Quelle photo de la zone choisir ?', true, true)
  expect(meme.points).toEqual(['Choisir la photo de la zone', 'Valider le prix'])
  expect(meme.bloquants.size).toBe(1)
  const autre = lireAToi(plan, 'On publie ?', true, true)
  expect(autre.points).toEqual(['Répondre : On publie ?', 'Valider le prix', 'Choisir la photo de la zone'])
})

test('« À toi »: Claude stops waiting as soon as it works again', () => {
  const tour = lireAToi(['Valider'], 'On publie ?', false, true)
  expect(tour.points).toEqual(['Valider'])
  expect(tour.arret).toBe(false)
  const agent = lireAToi(['! Valider'], '', true, false)
  expect(agent.arret).toBe(false)
  expect(agent.attend).toBe(false)
})

test('« À toi »: rereading ends when the list changes, not before', () => {
  expect(relecture(false, null, 'a')).toEqual({ relit: false, avant: null })
  const vu = relecture(true, null, 'a')
  expect(vu).toEqual({ relit: true, avant: 'a' })
  expect(relecture(vu.relit, vu.avant, 'a').relit).toBe(true)
  expect(relecture(vu.relit, vu.avant, 'b').relit).toBe(false)
})

test('« À toi »: the band says who has the hand', () => {
  const b = { points: 2, attend: false, reflechit: false, auTravail: 0 }
  expect(bandeauAToi(b)).toEqual({ texte: '☞ À toi · 2 points', couleur: 'suggestion' })
  expect(bandeauAToi({ ...b, points: 1, attend: true })).toEqual({ texte: '☞ À toi · 1 point · Claude t’attend', couleur: 'warning' })
  expect(bandeauAToi({ ...b, reflechit: true })).toEqual({ texte: '⏳ Claude réfléchit · rien à faire' })
  expect(bandeauAToi({ ...b, points: 0, auTravail: 1 })).toEqual({ texte: '⏳ Claude travaille' })
  expect(bandeauAToi({ ...b, points: 0, reflechit: true })).toEqual({ texte: 'Rien à faire pour toi' })
})

test('« À toi »: the detail view keeps two groups only when something blocks', () => {
  expect(groupesAToi(['A', 'B'], new Set())).toEqual([{ nom: 'À toi · 2', taches: ['A', 'B'] }])
  expect(groupesAToi(['A', 'B'], new Set(['A']))).toEqual([
    { nom: 'À répondre maintenant', taches: ['A'] },
    { nom: 'Quand tu peux', taches: ['B'] },
  ])
  expect(groupesAToi(['A'], new Set(['A']))).toEqual([{ nom: 'À répondre maintenant', taches: ['A'] }])
})

test('the lead’s line follows the same state', () => {
  expect(etatChef(false, 3, 0)).toBe('au travail')
  expect(etatChef(true, 3, 2)).toBe('')
  expect(etatChef(true, 0, 2)).toBe('attend ses tâches')
  expect(etatChef(true, 0, 0)).toBe('en pause')
})

test('one table of states: agents', () => {
  const vu = (statut: string, fin?: number) => { const e = etatAgent({ statut, fin }); return [e.texte, e.point, e.couleur, e.groupe] }
  expect(vu('running')).toEqual(['en cours', '●', 'suggestion', 'cours'])
  expect(vu('waiting')).toEqual(['attend', '●', 'warning', 'cours'])
  expect(vu('completed', 1)).toEqual(['rendu', '✓', 'success', 'fait'])
  expect(vu('failed', 1)).toEqual(['échec', '✗', 'error', 'fait'])
  expect(vu('killed', 1)).toEqual(['arrêté', '✗', 'error', 'fait'])
  expect(vu('running', 1)[0]).toBe('rendu')          // a finished agent that got a new message stays finished
  expect(etatAgent({ statut: 'completed' }).texte).toBe('rendu') // another session's agent has no end time
})

test('one table of states: plan words', () => {
  const vu = (x?: string) => { const e = etatDuPlan(x); return [e.point, e.couleur, e.groupe] }
  expect(vu('Rendu')).toEqual(['✓', 'success', 'fait'])
  expect(vu('contrôlé')).toEqual(['✓', 'success', 'fait'])
  expect(vu('en cours')).toEqual(['●', 'suggestion', 'cours'])
  expect(vu('échec')).toEqual(['○', 'error', 'lancer'])
  expect(vu('à lancer')).toEqual(['○', 'inactive', 'lancer'])
  expect(vu()).toEqual(['○', 'inactive', 'lancer'])
})

test('« À toi »: a message typed during a turn is only read at the end of the next one', () => {
  expect(lireApresTour(true, 100, 50)).toBe(false)
  expect(lireApresTour(true, 100, 100)).toBe(false)
  expect(lireApresTour(true, 50, 100)).toBe(true)
  expect(lireApresTour(false, 50, 100)).toBe(false)
})

const agent = (x = {}) => ({ id: 'a', nom: 'a', front: '', type: 'autre', statut: 'running', debut: 0, departVu: true, outils: 0, messages: 0, ...x })

test('live: an idle or a not-yet-started agent is not said to run', () => {
  expect(etatAgent({ statut: 'idle' }).texte).toBe('attend un message')
  expect(etatAgent({ statut: 'idle' }).groupe).toBe('arret')
  expect(etatAgent({ statut: 'pending' }).texte).toBe('démarre')
  expect(travaille({ statut: 'idle' })).toBe(false)
  expect(travaille({ statut: 'pending' })).toBe(true)
  expect(travaille({ statut: 'waiting' })).toBe(true)
  expect(travaille({ statut: 'running', fin: 1 })).toBe(false)
})

test('live: an agent gone from the list without a final status is not running, nor said to be done', () => {
  const perdu = relever(agent(), undefined, 9)
  expect(perdu.fin).toBe(9)
  expect(etatAgent(perdu).texte).toBe('sans nouvelles')
  expect(etatAgent(perdu).groupe).toBe('arret')
  expect(perdu.departVu).toBe(false) // its length is unknown: not in the history
  const fini = agent({ statut: 'completed', fin: 3 })
  expect(relever(fini, undefined, 9)).toEqual(fini)
})

test('live: an ended agent that gets a message runs again; its end time stays once set', () => {
  const repris = relever(agent({ statut: 'completed', fin: 3 }), 'running', 9)
  expect(repris.fin).toBe(undefined)
  expect(etatAgent(repris).texte).toBe('en cours')
  expect(repris.departVu).toBe(false)
  expect(relever({ ...agent({ statut: 'completed', fin: 3 }), dernier: 'vieux' }, 'running', 9).dernier).toBe(undefined)
  expect(relever(agent(), 'failed', 9).fin).toBe(9)
  expect(relever(agent({ fin: 3 }), 'failed', 9).fin).toBe(3)
})

test('live: a silent session is not said to work, nor its agents to run', () => {
  const v = { id: 'x', maj: 1000, auTravail: true, agents: [{ nom: 'a', statut: 'running', debut: 0 }] }
  expect(lireVoisine(v, 2000)!.agents.length).toBe(1)
  const silence = lireVoisine(v, 1000 + 31_000)!
  expect(silence.agents).toEqual([])
  expect(etatVoisine(silence, 1000 + 31_000)).toBe('sans nouvelles')
  expect(lireVoisine(v, 1000 + 31 * 60_000)).toBe(null)
  expect(lireVoisine({ id: 'x', maj: 0, agents: [] }, 31 * 60_000)).toBe(null) // ended session
})

test('live: a message that started no turn stops holding « À toi »', () => {
  expect(relitEncore(true, 1000)).toBe(true)
  expect(relitEncore(true, 31_000)).toBe(false)
  expect(relitEncore(false, 0)).toBe(false)
})

test('live: background work is measured at end of turn; past two minutes it is a memory', () => {
  expect(fondFrais({ vu: 0 }, 60_000)).toBe(true)
  expect(fondFrais({ vu: 0 }, 130_000)).toBe(false)
})

test('live: a question on screen during a turn reaches « À toi » and stops the session', () => {
  const x = lireAToi(['Valider'], 'On publie ?', true, true)
  expect(x.points[0]).toBe('Répondre : On publie ?')
  expect(x.attend).toBe(true)
})

test('live: unknown stays unknown after a reload', () => {
  expect(etatChef(true, 0, 0, false)).toBe('sans nouvelles')
  expect(etatVoisine({ maj: 1000, auTravail: null, agents: [] }, 2000)).toBe('sans nouvelles')
})

test('the band counts what the panel counts: a question merged into a plan point is not added', () => {
  const plan = lirePlan('# Pilotage : X\n## À toi\n- Choisir la photo de la zone\n', '/x')
  const n = lireAToi(plan.atoi, 'Quelle photo de la zone ?', true, true).points.length
  expect(resume(plan, 0, n)).toBe('Pilotage · À toi : 1')
})
