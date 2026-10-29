import { expect, test } from 'claude-code/testing'

import { action, appartient, nomCourt, duree, uneLigne, estimer, extraire, unePhrase, lireNom, lirePlan, sujets, resume, tempsPasse, couper, codeFront, etapes, morceaux, sujetsVisibles, mission, phrases, aQuoiSert, nomTache, etapeCourte, detailEtape, aDuDetail } from './register'

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

test('le nom donne le front et le type', () => {
  expect(lireNom('Héros · construction : refaire le haut')).toEqual({ front: 'Héros', type: 'construction' })
  expect(lireNom('Contrôle neutre de la v4').type).toBe('contrôle')
})

test('le plan est lu', () => {
  const p = lirePlan(PLAN, '/x')
  expect(p.chantier).toBe('Site Test')
  expect(p.cap).toBe('Maquette v6, lot 2 sur 3')
  expect(p.fronts.map(f => f.cells[0])).toEqual(['Héros', 'Photos'])
  expect(p.atoi).toEqual(['Valider la v6'])
  expect(p.attente).toEqual(['Avis Google statiques'])
})

test('estimation : rien sous cinq mesures, fourchette ensuite, alerte au-delà du 80e centile', () => {
  const d = (m: number) => ({ type: 'recherche', minutes: m, outils: 10 })
  expect(estimer('recherche', 1, [d(2), d(3)])).toBe(null)
  const histo = [1, 2, 2, 3, 3, 4, 5, 6, 9, 20].map(d)
  const debut = estimer('recherche', 1, histo)!
  expect(debut.bas).toBe(3)
  expect(debut.haut).toBe(6)
  expect(debut.long).toBe(false)
  expect(estimer('recherche', 7, histo)!.long).toBe(true)
})


test('le type contrôle, accentué, est reconnu', () => {
  expect(lireNom('Contrôle · contrôle : relire le mod')).toEqual({ front: 'Contrôle', type: 'contrôle' })
})

test('au-delà de la médiane : fourchette sur les seules tâches plus longues, rien s’il en reste moins de trois', () => {
  const d = (m: number) => ({ type: 'recherche', minutes: m, outils: 10 })
  const histo = [1, 2, 2, 3, 3, 4, 5, 6, 9, 20].map(d)
  const milieu = estimer('recherche', 4, histo)!
  expect(milieu.fourchette).toBe(true)
  expect(milieu.bas).toBe(6)
  const tard = estimer('recherche', 10, histo)!
  expect(tard.fourchette).toBe(false)
  expect(tard.long).toBe(true)
})

test('le cap se coupe en objectif, étape et action', () => {
  const [livrable, etape] = couper("mod Pilotage v1, lot 2 sur 2 : vérifier en vrai", ', ')
  expect(livrable).toBe('Mod Pilotage v1')
  expect(couper(etape, ' : ')).toEqual(['Lot 2 sur 2', 'Vérifier en vrai'])
  expect(couper('sans séparateur', ' : ')).toEqual(['Sans séparateur', ''])
})

test('le nom du chantier prend une majuscule', () => {
  expect(lirePlan('# Pilotage : panneau Pilotage\n', '/x').chantier).toBe('Panneau Pilotage')
})

test('le bandeau tient en une ligne', () => {
  const plan = lirePlan('# Pilotage : X\nCap : site v1, lot 2 sur 3 : héros\n\n## À toi\n- valider\n', '/x')
  expect(resume(plan, 1)).toBe('Pilotage · Lot 2 sur 3 · 1 agent en cours · À toi : 1')
  expect(resume(plan, 0)).toBe('Pilotage · Lot 2 sur 3 · À toi : 1')
})

test('le temps passé additionne la colonne duree_min, virgules entre guillemets comprises', () => {
  const csv = 'date,chantier,duree_min,description\n2026-10-07,a,39,"lu, écrit"\n2026-10-08,,,"non chiffré"\n2026-10-09,b,196,x\n'
  expect(tempsPasse(csv)).toBe(235)
  expect(tempsPasse('date,heures\n1,2\n')).toBe(0)
  expect(duree(45)).toBe('45 min')
  expect(duree(150)).toBe('2 h 30')
  expect(duree(235)).toBe('3 h 55')
  expect(duree(720)).toBe('12 h')
})

test('chaque action se dit en clair', () => {
  expect(action('Read', { file_path: '/a/b/register.tsx' })).toBe('a lu register.tsx')
  expect(action('Bash', { command: 'npm test', description: 'Lancer les tests' })).toBe('a lancé : Lancer les tests')
  expect(action('WebFetch', { url: 'https://code.claude.com/docs/x' })).toBe('a lu la page code.claude.com')
  expect(action('mcp__srv__get_thing', {})).toBe('a utilisé get_thing')
  expect(action('mcp__claude_ai_Gmail__search_threads', {})).toBe('a utilisé search_threads')
  expect(action('Bash', { command: 'curl -H "Authorization: Bearer x"' })).toBe('a lancé une commande')
})

test('le compte rendu donne son résumé et son pourquoi', () => {
  const cr = 'Long rapport…\n\n**En une phrase :** six fiches écrites.\nPourquoi : « gardé le ton des avis, écarté les prix »'
  expect(extraire(cr)).toEqual({ resume: 'six fiches écrites.', pourquoi: 'gardé le ton des avis, écarté les prix' })
  expect(extraire('rien')).toEqual({ resume: '', pourquoi: '' })
})

test('la mission tient en une phrase', () => {
  expect(unePhrase('Écris six fiches. Ensuite relis.')).toBe('Écris six fiches.')
  expect(unePhrase('')).toBe('')
})

test('le plan lit la section Fait', () => {
  expect(lirePlan('# Pilotage : X\n\n## Fait\n- Accueil validé (28/10)\n', '/x').fait).toEqual(['Accueil validé (28/10)'])
})

test('relecture v0.3 : dernière ligne du compte rendu, abréviations', () => {
  expect(extraire('Voici pourquoi : le test cassait.\nEn une phrase : fait.\nPourquoi : écarté X.').pourquoi).toBe('écarté X.')
  expect(unePhrase('Refais la maquette S.A. Durand sans toucher au héros. Puis relis.')).toBe('Refais la maquette S.A. Durand sans toucher au héros.')
})

test('un agent mal nommé retrouve quand même son front', () => {
  expect(appartient({ front: '', nom: 'Front B : bandeau cookies pleine largeur' }, 'B. Bandeau cookies pleine largeur + choix gardé')).toBe(true)
  expect(appartient({ front: '', nom: 'Front A : héros comme en v5.1' }, 'A. Héros et lignes laiton comme en v5.1')).toBe(true)
  expect(appartient({ front: '', nom: 'Front C : section des prix' }, 'D. Section zone compacte')).toBe(false)
  expect(appartient({ front: 'Héros', nom: 'Héros · construction : x' }, 'héros')).toBe(true)
})

test('une ligne au plus', () => {
  expect(uneLigne('Regrouper les styles du pied (base.css et pied.css).')).toBe('Regrouper les styles du pied (base.css et…')
  expect(uneLigne('Court')).toBe('Court')
})

test('le nom affiché perd son préfixe technique', () => {
  expect(nomCourt('Front A : héros comme en v5.1')).toBe('Héros comme en v5.1')
  expect(nomCourt('Héros · construction : refaire le haut')).toBe('Refaire le haut')
})

test('prochain lot rangé par sujet, « Toi : » rejoint À toi', () => {
  const p = lirePlan('# Pilotage : X\n## À toi\n- Valider\n## En attente\n- Toi : confirmer le prix\n- Zone : titre coupé\n- Zone: carte vide\n- Prix « à partir de » (salle de bain : 6 000 €) : à confirmer\n- Tester Safari\n', '/x')
  expect(p.atoi).toEqual(['Valider', 'Confirmer le prix'])
  expect(sujets(p.attente)).toEqual([
    { nom: 'Zone', taches: ['Titre coupé', 'Carte vide'] },
    { nom: 'À ranger', taches: ['Prix « à partir de » (salle de bain : 6 000 €) : à confirmer', 'Tester Safari'] },
  ])
})

test('la lettre du front relie le plan et le nom de l’agent ; les étapes du brief sont ses lignes numérotées', () => {
  expect(codeFront('F. Laiton dans chaque section')).toBe('F')
  expect(codeFront('Front E2 : estimateur sans vide')).toBe('E2')
  expect(codeFront('Intégration : tests')).toBe('')
  expect(etapes('Objectif : x\n1. Lire la charte\n2) Corriger les avis\n- fichier')).toEqual(['Lire la charte', 'Corriger les avis'])
})

test('une énumération se coupe en morceaux, pas dans les parenthèses', () => {
  expect(morceaux('Laiton dans chaque section (60-30-10), étoiles des avis, moitié droite')).toEqual(['Laiton dans chaque section (60-30-10)', 'Étoiles des avis', 'Moitié droite'])
  expect(morceaux('sections (index.html, pages.css) ; tests + chat')).toEqual(['Sections (index.html, pages.css)', 'Tests', 'Chat'])
})

test('le prochain lot tient dans la hauteur du panneau', () => {
  const base = { groupes: [3, 4], fil: false, ligne2: true, autres: 0, sujets: 8 }
  expect(sujetsVisibles({ ...base })).toBe(3)                  // hauteur inconnue : comme avant
  expect(sujetsVisibles({ ...base, rangees: 40 })).toBe(1)     // capture réelle : 1 sujet + « + 7 autres »
  expect(sujetsVisibles({ ...base, rangees: 60 })).toBe(8)     // grand écran : tout
  expect(sujetsVisibles({ ...base, rangees: 20 })).toBe(1)     // très petit : au moins un
})

test('la mission vient de la ligne « Mission : » du brief', () => {
  expect(mission('Mission : vérifier les deux retouches du panneau.\nRelis le diff de ~/Code/x…')).toBe('Vérifier les deux retouches du panneau.')
  expect(mission('Objectif : intégrer le lot v6.3 (site d’un artisan) et remettre la batterie au vert. Dossier : /Users/a/b. Pour reconstruire : `python3 src/build.py`.')).toBe('Intégrer le lot v6.3 (site d’un artisan) et remettre la batterie au vert.')
  expect(mission('Relis le diff. Puis autre chose.')).toBe('Relis le diff.')
})

test('fiche d’agent : mission sans étiquette, étapes en lignes courtes', () => {
  expect(mission('Objectif : la zone prend une carte pâle.\n1. Accueil')).toBe('La zone prend une carte pâle.')
  const e = etapes('1. Libellé : remplace « 35 km » partout :\n   - accueil\n   - contact\n\n2. Tester.')
  expect(e).toEqual(['Libellé : remplace « 35 km » partout :\n• accueil\n• contact', 'Tester.'])
  expect(phrases('Accueil : la carte en fond. Les noms restent par-dessus.')).toEqual(['Accueil : la carte en fond.', 'Les noms restent par-dessus.'])
})

test('tâche du chef expliquée en clair', () => {
  expect(aQuoiSert('live updates for artifact abc')).toMatch(/page publiée/)
  expect(aQuoiSert('Servir le site construit en local', 'python3 -m http.server 8000')).toMatch(/navigateur/)
  expect(aQuoiSert('Autre', 'sleep 5')).toMatch(/arrière-plan/)
})

test('tâche du chef nommée en français', () => {
  expect(nomTache('live updates for artifact 1234')).toBe('Suivi d’une page publiée')
  expect(nomTache('Servir le site construit en local')).toBe('Servir le site construit en local')
})

test('étape résumée : un titre et une ligne', () => {
  expect(etapeCourte('Libellé de la zone, la même formule partout : la zone exacte sera vue avec le client demain.\nRemplace « 35 km »'))
    .toEqual({ titre: 'Libellé de la zone', ligne: 'La zone exacte sera vue avec le client demain.' })
  expect(etapeCourte('Accueil : « sur la partie droite, la plus grande, je mettrais la carte de la région, zoomée sur le département, un peu pâle, en fond ». Les noms restent.').titre).toBe('Accueil')
  expect(etapeCourte('Tester sur Safari.')).toEqual({ titre: 'Tester sur Safari.', ligne: '' })
  expect(etapeCourte('Accueil « le client dit : la carte » à droite.')).toEqual({ titre: 'Accueil « le client dit : la carte » à droite.', ligne: '' })
  expect(etapeCourte('Accueil : « la map en fond », dit le client.').ligne).toBe('La map en fond, dit le client.')
})

test('détail d’une étape : rien de perdu ni de répété, puces et consignes techniques à part', () => {
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

test('gras Markdown et parenthèses dans une étape', () => {
  expect(etapeCourte('**Retirer les pages de ville** (décision du client : elles ne sont pas montrées demain).'))
    .toEqual({ titre: 'Retirer les pages de ville', ligne: '(décision du client : elles ne sont pas montrées demain).' })
  expect(etapeCourte('**DESIGN.md** : mets à jour la section.').titre).toBe('DESIGN.md')
  expect(etapeCourte('**`.preuve-note`** : tests/responsive.mjs donne 5 échecs.').titre).toBe('.preuve-note')
  expect(detailEtape('Note : a.\ntests/responsive.mjs donne 5 échecs.').lignes[1]).toEqual({ texte: 'tests/responsive.mjs donne 5 échecs.', puce: false, technique: true })
  expect(etapeCourte('**Libellé :** la zone sera vue demain.')).toEqual({ titre: 'Libellé', ligne: 'La zone sera vue demain.' })
  expect(etapeCourte('Contact : É. Dupont veut un bouton. Le mettre en haut.').ligne).toBe('É. Dupont veut un bouton.')
})

test('pas de détail à déplier quand le résumé dit déjà tout', () => {
  expect(aDuDetail('Lire les quatre exemples.')).toBe(false)
  expect(aDuDetail('Libellé : la zone sera vue demain.')).toBe(false)
  expect(aDuDetail('Libellé : la zone sera vue demain. Remplace « 35 km » partout.')).toBe(true)
  expect(aDuDetail('Libellé, partout : la zone sera vue demain.')).toBe(true)
})
