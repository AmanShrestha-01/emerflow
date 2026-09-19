# Concord — Design Spec

**Date:** 2026-09-18
**Event:** HopHacks 2026 (Sept 18–20, Johns Hopkins). 36 hours, team of 2.
**One line:** A hospital command board that refuses to place a patient when the records behind that decision disagree with each other.

---

## 1. The problem

Two real problems, and they compound:

1. **Records disagree.** A patient's history is scattered across hospitals, urgent care, specialists and pharmacies. One file says penicillin allergy, another says none. One says 10mg, another says 20mg. Roughly half of all text in an EHR is copy-pasted from an earlier note, so stale facts look current.
2. **Under surge, nobody checks.** When 25 patients arrive at once, placement decisions get made in seconds from whatever the chart says.

The compound failure is the one that hurts people: **a bed assignment that was logical, made from data that was wrong.**

## 2. What Concord does

For every placement decision, the allocator must declare which clinical facts it relied on. Before the placement is committed, only those facts are checked across every source on the patient. If the sources disagree, the placement is **held for a human** with both versions and their provenance on screen.

**Pitch line:** We don't flag every contradiction. We flag the ones that are about to change where a patient goes.

**Novelty:** existing work (research and hackathon prior art) does "find all conflicts in a chart." Nothing found does "find the conflicts that are decision-relevant right now." The `because` list is the mechanism that makes this possible and cheap.

## 3. Safety boundary (non-negotiable)

Concord **never places and never refuses.** It holds for human verification and displays both conflicting sources. It never states which value is correct.

Rationale: FDA's clinical-decision-support line. Software that outputs a single clinically appropriate recommendation for a time-critical decision is device-like. "These two sources disagree; a human must resolve this" is defensible. "Do not send this patient to step-down" is not.

## 4. Both halves on one screen

Concord is one product with one screen. Both original ideas are fully present and visible.

```
+---------------------------------------------------------------+
|  ER  ############### 112%   ICU  ########## 90%               |   <- Hospital Swarm
|  STEP-DOWN  #######  74%    OR  #####  53%                    |
|  avg wait 81 -> 43 min      placements held: 3                |
|                                    [ MASS CASUALTY ]          |
+---------------------------------------------------------------+
|  P-07  chest pain     -> ICU        COMMITTED   (green)       |   <- the junction
|  P-14  syncope        -> STEP-DOWN  HELD        (amber)       |
|  P-15  fracture       -> ER         COMMITTED   (green)       |
|  P-18  abd pain       -> STEP-DOWN  HELD        (amber)       |
+---------------------------------------------------------------+
|  P-14 HELD: decision rested on "no anticoagulant"             |   <- DeepChart
|    Hospital B  (Feb 4, 2026)   warfarin 5mg   ACTIVE          |
|    Local intake (today)        no anticoagulants              |
|    -> sources disagree; human must resolve                    |
+---------------------------------------------------------------+
```

- **Top zone is Hospital Swarm:** department capacity bars, live occupancy, the surge button, and the before/after metrics.
- **Middle zone is the junction:** the placement decisions themselves, green or amber.
- **Bottom zone is DeepChart:** the conflict, both sources, their dates, and the provenance.

### Department agents are kept

Each department (ER, ICU, step-down, OR) gets a small function that reports its own state in plain English — "1 bed left, refusing anything non-critical", "no nurse free for 12 minutes". One Gemini call turns these into the board's narration line. This is cheap (a few hours total) and it is what makes the hospital half feel alive.

What was removed is only the machinery underneath: the discrete-event simulator and the math solver. A patient list plus a timer produces the identical visible behavior, and a greedy allocator produces the identical visible decisions. Nothing a judge can see is lost.

## 5. Architecture

```
Synthea bundles (20 patients)
    -> source splitter (2–3 pretend sources per patient)
    -> CONFLICT PLANTER  ->  answer key (ground truth JSON)
    -> patient queue  <-- [MASS CASUALTY button injects 25]
    -> ALLOCATOR: proposes (unit, because=[facts])
    -> CROSSCHECK: verify only `because` facts across sources
         |-- conflicts -> HOLD (amber row + provenance)
         `-- clean     -> COMMIT (green row)
    -> board (1s polling)
    -> score screen: planted N, caught M
```

### Core loop

```python
patients = surge.inject(25)

for p in patients:
    plan = allocator.propose(p, hospital.state())
    # plan.unit    = "stepdown"
    # plan.because = ["no_anticoagulant", "stable_vitals", "no_icu_need"]

    verdict = crosscheck.verify(p.records, facts=plan.because)

    if verdict.conflicts:
        hospital.hold(plan, verdict)
    else:
        hospital.commit(plan)
```

`plan.because` is load-bearing. Because the allocator names the facts it relied on, crosscheck examines a handful of facts instead of a whole chart — which is why this is fast enough to run during a surge, and why every flag that appears is one a human should care about.

## 6. Components

| # | Component | Purpose | Depends on |
|---|---|---|---|
| 1 | Source splitter | Turn one Synthea bundle into 2–3 pretend provider sources | Synthea download |
| 2 | **Conflict planter** | Deliberately inject dose changes, dropped allergies, stale dates, brand/generic swaps; emit answer key | splitter |
| 3 | Patient queue + surge | Timer adds patients; button injects 25 | — |
| 4 | Allocator | Pick a unit; return `because` list | queue, hospital state |
| 5 | **Crosscheck** | Extract per-source claims for the named facts; adjudicate contradiction; return provenance | planter output, Gemini |
| 6 | Board | Rows, green/amber, detail panel with both sources | all above |
| 7 | Score | Precision/recall vs. answer key | planter, crosscheck |

## 7. Stack (deliberately small)

- **Python + FastAPI** — one long-lived process, all state in memory
- **One React page (Vite)** — polls `/state` once per second
- **Gemini** — the two crosscheck calls (also makes us eligible for the HopHacks Gemini sponsor prize)
- **JSON files** — no database

### Explicitly rejected
- **SimPy** — a list plus a timer does everything the demo shows; SimPy's blocking real-time loop fights FastAPI.
- **OR-Tools** — greedy "first free bed that fits" is 20 lines and is defensible: optimizing on wrong data faster is not the problem we're solving.
- **Neo4j / any database** — in-memory only. Judges cannot see the store; they can see whether provenance links work.
- **WebSockets** — 1s polling is visually identical and removes a whole failure class.
- **SNOMED** — full distribution requires a UMLS license (~5 business days). Ship a curated ~50-code map for the demo patients plus public RxNav for medications. RxNorm + LOINC is a complete story.

## 8. The known trap, and the answer

**Synthea does not generate conflicting records.** Its split-by-organization feature duplicates data; it does not contradict it. Point agents at raw Synthea and every reported conflict is a false positive.

This is why the conflict planter is a first-class deliverable, not data prep. It converts the project's biggest vulnerability into its strongest claim: a real precision/recall number against known ground truth. **State this before a judge finds it.** Volunteered, it reads as good method; discovered, it reads as a flaw.

## 9. Demo script (90 seconds)

1. Calm board, six green rows.
2. "Half of what's in a hospital chart is copy-pasted from an older note. So when a hospital is overloaded and has to decide where patients go fast, it's deciding from records that disagree with each other. Press that."
3. Judge presses **MASS CASUALTY**. 25 patients flood in. Three rows turn amber and stop.
4. Click one: "This patient was headed to step-down because the chart says no blood thinner. The outside hospital's record from three weeks ago says warfarin, active. Today's intake says none. We don't know which is true, so we won't let the placement through until a human looks."
5. "We planted fifty conflicts in this data ourselves. It caught forty-six. Three mattered enough to stop a placement."

## 10. Schedule (36h)

| Hours | Work | Owner |
|---|---|---|
| 0–1 | Repo, FastAPI up, React page with hardcoded board; prove the halves talk | both |
| 1–5 | Synthea load, source splitter, **conflict planter + answer key** | backend |
| 1–5 | Board layout: rows, green/amber, detail panel shell | frontend |
| 5–11 | Crosscheck: claim extraction + adjudication + provenance | backend |
| 5–11 | Detail panel: two sources side by side | frontend |
| 11–15 | Allocator with `because`; hold vs. commit; wire to board | both |
| 15–18 | Sleep (stagger if you must) | |
| 18–24 | Surge button, polling, make it feel fast | both |
| 24–28 | Score screen, polish, remove dead UI | frontend |
| 28–32 | Rehearse the 90 seconds aloud x10; README | both |
| 32–36 | Devpost submission + breakage buffer | both |

**Hard rules:** first commit must be after kickoff (downloading data beforehand is fine, writing code is not). Hour 32 is a wall, not a suggestion.

## 11. Cut order when behind

1. 20 patients -> 10
2. Three sources -> two
3. Two Gemini calls -> one combined call
4. Drop the arrival timer; the button becomes the only way patients arrive
5. Score screen last (cheap, and it is the best slide)

**Never cut:** the conflict planter, the answer key, the clickable provenance. Those three are the project.

## 12. Objections to pre-load

| Objection | Answer |
|---|---|
| "Why do you need AI? Use rules." | Deciding whether two differently-worded records contradict each other is not a rule or a solver problem. The allocator deliberately has no AI. |
| "You planted the conflicts yourself." | Yes — stated up front. That is what makes precision/recall measurable at all. |
| "One big model already does FHIR med reconciliation well." | Our contribution is cross-source adjudication with provenance and decision-relevance filtering, not extraction. |
| "Is this a medical device?" | No. It holds for human verification and never asserts which value is correct. See section 3. |
| "Is that real patient data?" | No — synthetic Synthea bundles, with conflicts we injected. |

## 13. Policy framing (verified)

- **Use:** TEFCA record exchange went from ~10M records in Jan 2025 to ~500M by Feb 2026. 45 CFR 170.315(b)(2) requires certified EHRs to *offer* reconciliation of medications, allergies and problems — it requires nothing that *finds* the contradictions.
- **Use:** USCDI v3 became the binding regulatory floor on Jan 1, 2026 (45 CFR 170.213); that is where LOINC/RxNorm/SNOMED are actually required.
- **Do NOT say "CMS requires."** The CMS 2026 Interoperability Framework is **voluntary** — a pledge, no rulemaking, no penalty. Its FHIR criteria date (July 4, 2026) has already passed.

## 14. Open questions

- Teammate's stronger half (frontend vs. Python) — decides the owner column in section 9.
- Whether to add Postgres late for the Tiger Data sponsor prize. Default: no.
