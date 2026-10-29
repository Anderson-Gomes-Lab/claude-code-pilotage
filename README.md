# Pilotage — un tableau de bord de chantier pour Claude Code

Un mod pour Claude Code qui affiche, à côté de la conversation, **où en est le chantier** : ce que Claude attend de toi, qui travaille, ce qui est fait, et ce qui vient ensuite.

> **English summary.** A Claude Code mod that docks a "flight plan" pane beside the chat: what is waiting on you, who is working (subagents and background tasks), what is done and what comes next. It combines a small `PILOTAGE.md` file that Claude keeps in the project folder with what the mod observes live (agents, background tasks, end-of-turn questions). The interface is in French.

<p align="center">
  <img src="docs/panneau.png" alt="Le panneau Pilotage" width="420">
</p>

---

## Pourquoi

Sur un vrai projet, on finit vite avec plusieurs choses en parallèle : une session qui code, des agents qui cherchent ou relisent, des retours qu'on envoie au fil de l'eau. Et on perd le fil :

- *Qu'est-ce que Claude attend de moi, là, maintenant ?*
- *Qui travaille, et sur quoi ?*
- *Qu'est-ce qui est fait, qu'est-ce qui vient ensuite ?*

Le panneau répond à ces trois questions d'un coup d'œil, sans rien taper. Il est né d'un chantier de site web où un seul agent faisait tout, où les retours s'empilaient et où personne ne voyait l'organisation.

## Ce qu'il affiche

La vue d'ensemble tient sur un écran ; le détail s'ouvre au clic.

| Bloc | Ce qu'on y voit |
| --- | --- |
| **À toi** | une ligne en tête. **Bleu** : des points que tu peux traiter. **Orange** : Claude s'est arrêté et t'attend. **Gris** « Claude réfléchit · rien à faire » : Claude travaille, tes points reviendront quand il aura fini. Un clic montre la liste : « À répondre maintenant », puis « Quand tu peux ». |
| **Objectif** | le livrable et l'étape, l'action du moment, le temps passé. |
| **Équipe** | le **chef** (la session) et son état ; pendant qu'il travaille, `↳` dit ce qu'il fait à l'instant. Puis **Agents en cours**, **Tâches du chef** (⚙ commandes, serveurs, suivis lancés en arrière-plan : ce ne sont pas des agents), **À lancer**, **Fait**. |
| **Prochain lot** | le travail à venir rangé par sujet, autant de sujets que l'écran en tient, le reste en « + N autres ». |
| **?** | à côté d'un agent, d'une tâche, d'un sujet ou d'un point : prépare `/btw Question sur « … » :` dans la zone de saisie, pour poser une question sans interrompre Claude. |

Au clic :

- **Un agent** : ce dont il est en charge, ses fichiers, sa mission en une phrase, ses étapes (un titre et une ligne chacune ; « Tout le détail » les déplie), ce qu'il a rendu et pourquoi, ses dernières actions.
- **Une tâche du chef** : à quoi elle sert, depuis quand elle tourne, sa commande.
- **Un sujet du prochain lot** : ses tâches.

Quand le panneau est fermé, un **bandeau d'une ligne** au-dessus de la zone de saisie résume la situation, avec un bouton **Ouvrir**.

<p align="center">
  <img src="docs/bandeau.png" alt="Le bandeau au-dessus de la saisie" width="640">
</p>

## Comment ça marche

Le panneau croise deux sources.

```
 PILOTAGE.md (écrit par Claude)          ce que le mod voit en direct
 ─────────────────────────────           ─────────────────────────────
 Cap, fronts, Fait, À toi,               agents lancés et finis, leur brief,
 En attente                              tâches en arrière-plan, question
                │                        posée en fin de tour, ton message
                └──────────────┬─────────────────┘
                               ▼
                        le panneau Pilotage
```

- **Le plan de vol** (`PILOTAGE.md`) dit l'intention : le cap, les fronts de travail, ce qui est fait, ce qu'on attend de toi, ce qui vient ensuite. Claude l'écrit et le tient à jour ; toi, tu ne fais que le lire dans le panneau.
- **Le direct** dit la réalité : un agent lancé apparaît tout de suite avec sa mission ; une question posée par Claude en fin de tour entre d'office dans « À toi » ; dès que tu écris, « À toi » passe en gris le temps que Claude relise.

Le panneau ne fait donc que montrer. Sa justesse dépend de deux choses : que Claude tienne `PILOTAGE.md` à jour (la méthode plus bas), et qu'il nomme et briefe ses agents selon une convention simple.

### Comment il trouve le chantier

Le mod cherche un `PILOTAGE.md` dans le dossier de la session ou au-dessus ; sinon, celui que la session a lu ou écrit pendant la conversation (le lien est gardé). Il ne montre jamais le chantier d'une autre session. Sans fichier, il le dit.

## Le fichier `PILOTAGE.md`

```markdown
# Pilotage : Site de Durand Menuiserie
Mis à jour : 14/11/2026
Cap : Site v1, lot 2 sur 3 : pages réalisations

## Sessions
| Session | Livrable | Dossier | État |
| --- | --- | --- | --- |
| Site | pages, design, mise en ligne | ~/sites/durand | en cours |

## Fronts de cette session
| Front | Fichiers | Agent | État |
| --- | --- | --- | --- |
| Réalisations | realisations/*.html | Réalisations · construction : 6 fiches chantier | en cours |
| Contrôle | aucun | Contrôle · contrôle : relire le lot 2 | à lancer |

## Fait
- Cadrage validé avec le client (10/11)

## À toi
- ! Photos : demander au client l'avant/après de la cuisine
- Accueil : la valider sur ton téléphone

## En attente
- Devis : formulaire en ligne après la v1
- Avis : bloc sur l'accueil quand le client en aura dix
- Toi : relancer le client pour les textes de l'équipe
```

| Section | Règle |
| --- | --- |
| `Cap` | `livrable, étape : action`. Le panneau découpe la ligne tout seul. |
| `Fronts` | un front = des fichiers à lui et un livrable. États reconnus : `à lancer`, `en cours`, `rendu`, `contrôlé`. |
| `Fait` | une ligne en français courant par lot fini, avec la date. |
| `À toi` | tout ce qu'on attend de toi et que tu peux faire **tout de suite** (question, validation, test, capture), au format `Thème : détail`. Un `!` en tête marque ce qui bloque la suite : il passe en premier. |
| `En attente` | chaque ligne commence par son responsable : un sujet court (le panneau regroupe par sujet) ou `Toi :` (le panneau le passe dans « À toi »). |

D'autres exemples dans [`exemples/`](exemples/) : site d'artisan, automatisation de mails, étude d'outils, formation.

## La méthode, côté Claude

Le panneau n'est juste que si Claude suit quelques règles. Colle ceci dans le `CLAUDE.md` de ton projet, ou dans `~/.claude/CLAUDE.md` pour tous tes projets :

```markdown
## Pilotage
- Au démarrage d'un chantier : un stop, puis `PILOTAGE.md` à la racine (modèle : README du mod Pilotage). Le montrer en cinq lignes, attendre la validation.
- Un agent par front, seulement si les fronts touchent des fichiers différents. Un agent qui a rendu son lot ne reçoit pas le suivant : lot suivant = agent neuf.
- Nommer chaque agent `Front · type : action` (types : recherche, construction, correction, contrôle), relecteur compris.
- Le brief d'un agent commence par `Mission : <une phrase simple, sans chemin ni jargon>`, puis ses étapes numérotées (`1. …`, une action courte par ligne), puis le détail technique. Le compte rendu finit par `En une phrase : …` et `Pourquoi : …`.
- « À toi » : tout ce qu'on attend de moi, dans le même tour. Le mettre à jour en premier quand mon message y répond. Une vérification sort d'« À toi » dès qu'on retouche ce qu'elle vérifie, et y revient à la publication. Deux points faits par le même geste n'en font qu'un.
- Une question qui m'est posée passe par « À toi » ou par la question de fin de tour, jamais seulement dans le texte.
- À chaque lot fini : contrôle neutre, ligne dans « Fait », « En attente » rangé par sujet.
```

Ce qui se passe à chaque étape :

1. **Démarrage** : Claude écrit le plan de vol. Le panneau s'ouvre seul.
2. **Chaque message** : Claude le range (même front, autre front, autre chantier, simple question) et met « À toi » à jour en premier. Pendant qu'il travaille, « À toi » est en gris.
3. **Agents** : chacun apparaît dans « Agents en cours » avec sa mission et ses étapes, puis dans « Fait » avec ce qu'il a rendu et pourquoi.
4. **Fin de tour** : si Claude te pose une question, elle entre dans « À toi ». S'il s'arrête pour t'attendre, la ligne passe en orange.
5. **Fin de lot** : contrôle neutre, « Fait » complété, prochain lot rangé par sujet.

## Les estimations de durée

Les modèles estiment mal la durée de leur propre travail. Le mod ne demande donc rien à Claude : il **mesure**. Chaque agent terminé est enregistré (type, durée, nombre d'actions) ; un agent qui dépasse la durée habituelle de son type est signalé « long ». Rien sous 5 mesures : mieux vaut pas de signal qu'un signal faux. Le type se lit dans le nom de l'agent (`Front · type : action`).

## Le temps passé

Si un fichier `temps.csv` avec une colonne `duree_min` se trouve dans le dossier du chantier ou au-dessus, la carte Objectif en affiche le total. Sans ce fichier, rien.

## Installer

Depuis un terminal :

```bash
claude plugin marketplace add Anderson-Gomes-Lab/claude-code-pilotage
```

```bash
claude plugin install pilotage@claude-code-pilotage --scope user
```

`--scope user` l'active dans tous tes projets. Dans l'appli de bureau : **+** à côté de la zone de saisie, **Plugins**, **Add marketplace** avec `Anderson-Gomes-Lab/claude-code-pilotage`, puis **Add plugin**.

Le panneau s'ouvre seul dès que la session a un `PILOTAGE.md`. Sinon : `/panneau-pilotage`.

**Mettre à jour** : `claude plugin marketplace update claude-code-pilotage`, puis `claude plugin update pilotage@claude-code-pilotage`. Les sessions ouvertes prennent la nouvelle version d'elles-mêmes ; si l'une ne suit pas, `/reload-plugins` dans cette session.

## Ce que le mod écrit sur ta machine

- `~/.claude/pilotage/durees.json` : durées des agents finis (type, minutes, nombre d'actions ; aucun contenu).
- `~/.claude/pilotage/sessions/<id>.txt` : le chantier lié à chaque session.
- `~/.claude/pilotage/missions/<id>.json` et `finis/<id>.json` : briefs et comptes rendus des agents, pour les revoir après un rechargement.
- `~/.claude/pilotage/ecran.json` : la hauteur du panneau, pour régler ce qui tient à l'écran.
- `<chantier>/.pilotage/<id>.json` : les agents en cours de chaque session, pour les autres sessions du même chantier. Un `.gitignore` y est créé.

Rien ne sort de ta machine.

## Limites

- Interface en français.
- Le panneau prend la place de la colonne Détails de l'appli de bureau ; d'où le bandeau quand il est fermé.
- Ce que le panneau dit de l'intention (« À toi », prochain lot) dépend de Claude qui tient `PILOTAGE.md` à jour. Le direct (agents, tâches, questions de fin de tour) ne dépend que du mod.
- Les mods de Claude Code sont récents : une mise à jour de Claude Code peut demander une mise à jour du mod.

## Contexte

Construit par [Anderson Gomes](https://github.com/Anderson-Gomes-Lab), consultant en automatisation, pour piloter ses propres chantiers avec Claude Code. Partagé tel quel, sans engagement de support. Les retours sont bienvenus dans les *issues*.

Licence MIT.
