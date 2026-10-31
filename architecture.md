# Architecture

Pilotage is a pane for Claude Code: it shows where a project stands, from what the session measures and from the project's `PILOTAGE.md`.

## Pieces

- `hooks/register.tsx`: the whole mod. Pure functions first (exported, tested), then `register`: the session's live state, its hooks, and the pane's views.
- `hooks/pur.test.ts`: the pure functions.
- `hooks/register.test.tsx`: the hooks, read through the state file a session shares.
- `hooks/vues.test.tsx`: each view, drawn by the engine's test kit.
- `skills/method/SKILL.md`: the method that keeps `PILOTAGE.md` fed. The mod is useless without it.
- `types/index.d.ts`: the mod's data shapes.
- `.claude/verifier.sh`: the checks, fast or `complet`, with Claude Code 2.1.309 or newer.
- `dev/`: the dev tools, out of the root on purpose: a lockfile at the root makes the engine install them for every user.

## Data

- `PILOTAGE.md`, in the project: the plan. Read every 5 s, never written.
- `.pilotage/<session>.json`, in the project: what each session shares with the others.
- `~/.claude/pilotage/`: past agent durations, finished agents, briefs, the session's project link.
- `temps.csv`, in the project or above: time spent.

## Choices

- One rule: a present state comes from a live measure; the plan is an intention. Unknown stays unknown ("sans nouvelles").
- The state's words, dots and colors live in one table, `ETATS`.
- Everything sits in one file until views are split out: the view tests now allow it.
- The mod itself has no dependency.
- The repository is public: no client, prospect or city name, in tests either.

## Measures (31/10/2026)

| Measure | Today | Threshold |
| --- | --- | --- |
| Biggest file | register.tsx, 1,232 lines | 1,232 (others 461) |
| Function complexity | 109, the pane's render | 109 in register.tsx, for all its functions (others 6) |
| Duplication | 0 % | 0 % |
| Unused exports | 0 | 0 |
| Tests | 90 | |
