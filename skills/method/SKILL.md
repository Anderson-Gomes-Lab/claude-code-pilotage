---
name: method
description: Run a project with a flight plan shown in the Pilotage pane. Use it when the person starts or resumes any project with a deliverable and several steps (website, app, automation, content), when a PILOTAGE.md exists in the project, when a second workstream appears, and when they say "where are we", "I'm lost" or "how many agents". Stops to write PILOTAGE.md first, routes each message in one line, keeps "À toi" true, closes each batch.
---

# Pilotage method

The person sends ideas as they come. Holding the frame is your job, and you say what you are doing in one line each time.

The pane displays `PILOTAGE.md`. If the file is wrong, the pane is wrong. They read the pane, not your messages.

## Rules that matter

- **One session, one project.** A project has its own deliverable and files.
- **Only the project's session writes its `PILOTAGE.md`.** Another session sends it a message.
- **As few agents as possible.** One workstream: no agent, the session does the work. Subagents for three things: independent parallel work, verbose research, a review with fresh context. Several workstreams on separate files: one agent each, five at most.
- **An agent that delivered its batch does not get the next one.** Next batch, new agent, clean brief.
- **The coordinator does not code while its agents run.** It prepares the next batch, reviews, answers.

## 1. Start: stop first

When: a new project, a project without `PILOTAGE.md`, or a second workstream appearing.

1. Say "Stop, let's frame this first, one minute." Produce nothing before that.
2. Work from the project's folder. If they have none, create one named after the project and say so.
3. Write `PILOTAGE.md` at the project root (template below) before asking anything: `Cap :` says `<deliverable>, framing : waiting for your approval`, the plan's approval is a `!` line in `## À toi`, what you need from them are lines below it.
4. Summarise the plan in five lines at most, in plain words. They approve, then the work starts.

Talk to the person in their words: no "workstream" or "batch" if they are not technical. The pane is in French: the first time, say that "À toi" means "your turn".

**A small project is the normal case.** Work done in sequence stays in the session: put `—` in the `Agent` column. `État` decides where a row shows: `à lancer` under "À lancer"; `en cours` with `—` is left out, since the session's own line says what it is doing; `rendu` or `contrôlé` under "Fait". Only write an agent's name when you will really start one. `## Sessions` is only needed with several sessions. `## Fait` starts empty.

## 2. Each message: route it

Before acting, place the message and say so in one line, with the reason ("→ Home workstream: those are its files, I'm passing it to its agent").

| Case | Sign | Action |
| --- | --- | --- |
| Same workstream | touches its files | to its agent if it has not delivered, otherwise next batch |
| Other workstream, same project | other files of the project | new agent, one more row in the table |
| Other project | other deliverable, other folder | suggest a separate session, with a full brief |
| Question, opinion | nothing to produce | answer here |

Feedback joins a running batch only if it touches the same files and fits in one line. Otherwise it waits in `## En attente`. Several messages in a row: group them, one message per agent. In doubt: decide and say so.

## 3. "À toi": one principle

**`## À toi` says, at any moment, what the person can do now. Nothing else.**

What follows from it:

- Everything they can do now goes in during the same turn: question, approval, test, screenshot, command to type. A question asked only in your text does not exist for them.
- Sort each point by what happens today, not later: the work is stopped without them, `!` in `## À toi`; they can do it and nothing waits, `## À toi` without `!`; they cannot do it yet (a meeting ahead, work in progress), `Toi : …` in `## En attente`, moved up once doable.
- What is no longer true comes out at once. A point they answered comes out first, before any other work. A check of something you are changing waits in `## En attente` as `Toi : …` and comes back when it can be done.
- Two points done by the same gesture are one point.
- Nothing to do: empty section. No note, no rule, no "nothing for now" line.

## 4. End of batch

1. A neutral review by a subagent with fresh context: it gets the diff and the requirement, not your reasoning. If something visible changed, look at the result yourself.
2. `PILOTAGE.md` up to date: one plain line in `## Fait` with the date. `## En attente` only keeps the future.
3. Three lines to the person: done, in progress, next.
4. A workstream has grown: split it.

## 5. End of project

Deliverable handed over: add `Livré : <date>` under `Cap :`, empty `## À toi`, keep `## Fait`. The pane says the project is delivered. What remains opens a new project.

## Briefing an agent

- Name, in the `description` field of the Agent tool: `Front · type : action`, reviewers included. Type is one of `recherche`, `construction`, `correction`, `contrôle` (research, build, fix, review). The pane uses it to file the agent and estimate its duration.
- First lines of the brief, for the person (the pane shows them): `Mission : <one simple sentence, no paths, no jargon>`, then numbered steps, ten words at most each. Two actions make two steps.
- Then, for the agent: files it may touch and files it must not, what is approved and stays untouched, the deliverable, the check, what was already ruled out.
- Its report ends with `En une phrase : …` and `Pourquoi : …`, without jargon.

## PILOTAGE.md template

Section names are fixed French words: the pane reads them. Keep them exactly. Keep the space before each colon in `X : y`. The content can be in any language.

```markdown
# Pilotage : <project>
Cap : <deliverable>, <stage> : <current action>

## Sessions
| Session | Deliverable | Folder | État |
| --- | --- | --- | --- |
| Website | pages, design, launch | ~/sites/northwind | en cours |

## Fronts
| Front | Files | Agent | État |
| --- | --- | --- | --- |
| Projects | projects/*.html | Projects · construction : 6 project pages | en cours |

## Fait
- one plain line per finished batch (date)

## À toi
- Topic : detail
- ! Topic : detail

## En attente
- Topic : task for a later batch, in plain words, no file names
- Toi : something for the person, later
```

`État` is one of: `à lancer`, `en cours`, `rendu`, `contrôlé`. A leading `!` in `## À toi` marks what stops the work until they act: it comes first, in orange, and only then does the pane say you are waiting. Full examples: `examples/` in the mod's repository.
