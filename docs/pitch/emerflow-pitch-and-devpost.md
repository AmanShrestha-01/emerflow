# Emer Flow — pitch, demo script, Devpost text, submission checklist

Numbers marked ⟨…⟩ get filled in from the recorded demo run (`GET /api/results`, `GET /api/deepchart/score`).
DeepChart-specific judge Q&A lives in `docs/pitch/deepchart-pitch.md`; this file covers the whole product.

## The line
> When 25 patients arrive at once, a hospital decides where people go in seconds, from records that often
> disagree. Emer Flow gives every department an AI agent that negotiates beds in the open, lets code enforce
> every hard rule, and pauses any move whose records disagree until a doctor checks them.

**AI talks. Code checks. A human decides.**

## Why now (say this in the first 20 seconds)
- The NHS's own bed-allocation project at Kettering General Hospital built a greedy allocator with forecasting.
  They reported that it couldn't adapt to "changed ward layouts or flu admission peaks", and it stayed a proof of concept.
  Emer Flow's agents re-plan every few minutes. Press **Busy night** and they adapt to a flu peak live.
- About half of hospital-record text is copied forward from older notes. Stale facts look current, and in a surge nobody checks them.

## 90-second demo (one laptop: board tab + DeepChart tab)

| # | On screen | Say |
|---|---|---|
| 1 | Board, normal evening: patients arriving, agents talking | "This is a hospital on a normal evening. Every department has an AI agent. ICU is Veil, cautious. The ER is Apex, blunt. They negotiate beds in the open." |
| 2 | Point at one patient row: gunshot → **Needs: Emergency surgery** → Resus → Surgery | "A gunshot wound walks in. The fast lane puts him in resus instantly, then the plan gets him to an operating room. Every row says what's wrong, what they need, where they're going and who decided." |
| 3 | Press **Bus crash** | "Now a bus crash. 25 patients at once." |
| 4 | Conversation: ICU asks Step-down, Step-down asks Staffing, ICU objects | "Watch them talk. ICU asks Step-down to take three recovering patients. Step-down is full, so it asks Staffing. ICU objects that the plan leaves no reserve. That's real Gemini, not a script." |
| 5 | A row turns amber: **Paused before ICU — two records disagree** | "The plan wanted this patient in ICU. The records check paused it, because the move relies on 'no blood thinner' and two hospitals disagree." |
| 6 | Click **Check records in DeepChart** → chart shows both records | "One click takes the ER doctor into DeepChart. Here are both records, with dates and sources. We never say which one is right." |
| 7 | **Records checked — move to ICU** → back to board, patient in ICU | "The doctor checks, the move goes ahead, and it's logged with a reason." |
| 8 | Open **Results** | "We planted the record mistakes ourselves, so we can measure. It caught ⟨X of Y⟩ before a patient moved. Critical patients got a bed in ⟨0⟩ minutes. Every decision is in this audit log." |

**Close:** "Emer Flow doesn't replace doctors or hospital systems. It sits on the data hospitals already have, so the
decision that matters most in a surge (who goes where) is made fast, in the open, and never on records nobody checked."

## Numbers we can honestly claim
- **Record mistakes caught before a patient moved:** ⟨X of Y⟩ (planted by us; answer key). `/api/results` → `records`.
- **DeepChart overall:** ⟨11 of 11⟩ conflicts flagged, ⟨11 of 11⟩ lookalike patients shown as "possible". `/api/deepchart/score`.
- **Critical (severity 1) patients:** longest wait for a bed was ⟨0⟩ min in a 25-patient surge. `/api/results` → `time_to_bed`.
- **Agents:** 10 Gemini agents (8 departments, a coordinator, radio intake), all on Gemini 3.6 Flash, one plan every ⟨~15⟩ s.
- **Don't claim** that the AI beats the rules on wait times. In our comparison, the rule-based ladder matches it in
  stub mode, and we haven't measured enough live runs to claim more. The AI's value is negotiation you can see,
  handling the odd case, and explanations. The safety value is the records check and the human gate.

## Judge questions (swarm side)
**"Where does the data come from?"**
In a hospital, each agent reads a system the hospital already has:
- the bed-tracking feed of admissions, discharges and transfers;
- the surgery schedule;
- the staffing roster;
- the radiology worklist;
- blood bank stock;
- EMS pre-arrival notices;
- records from other hospitals in FHIR.

For the demo it's a synthetic hospital, because real patient data is protected, and it lets us plant known mistakes and measure. Each agent reads through one small view function, so switching to real feeds doesn't change the agents.

**"Why AI agents and not an optimizer?"**
The math is done by code. Every move is checked by a validator, and the bed arithmetic is code. The agents do what code can't: negotiate trade-offs between departments that want different things, handle cases nobody wrote a rule for, and explain each decision in plain words. When Gemini is slow or down, rule-based answers take over, so the board never stops.

**"How many agents, and are they really different?"**
There are 10.
- **8 departments,** each with its own persona, goal, limits and temperature. They're named after Kairos-style thinking archetypes: ER *Apex* (cuts to the core), ICU *Veil* (hidden risk), Step-down *Forge* (builds chains), Surgery *Crux* (trades), Staffing *Root* (counts nurses first), Imaging *Trace* (dependencies), Blood bank *Void* (what runs out), EMS *Orbit* (beyond our walls).
- **The coordinator,** *Prism*.
- **Radio intake,** which turns an ambulance radio message into incoming patients.

**"What stops the AI from doing something dangerous?"**
- **The agents can't pick bed numbers.** They can't invent patients, because patient IDs are an enum built from live state.
- **Code rejects impossible moves:** full units, nurse ratios, the wrong unit for how sick someone is, and moves above the current escalation level.
- **The records check pauses any move whose facts disagree across records.** A critical patient is never paused over paperwork: the move goes ahead and gets flagged.
- **Big actions wait for a human:** cancelling surgery, calling in staff, ambulance diversion and transfers out.

**"Is it reliable enough to demo?"**
Every live run is recorded. Replay mode plays a recorded Gemini run back exactly, with no network needed. If the hospital drifts from the recording, the rules fill in.

**"Isn't this a medical device?"**
It never gives a clinical instruction and never says which record is right. It shows the disagreement and a human decides. The triage note ("needs emergency surgery") names the kind of bed or service, not a treatment. See `docs/pitch/deepchart-pitch.md` for more.

## Devpost

**Emer Flow: a hospital that negotiates its beds in the open, and never moves a patient on records nobody checked.**

**Inspiration.** In a surge, hospitals decide who goes where in seconds, and the records behind those decisions often disagree, because half of hospital text is copied forward. The NHS's own bed-allocation pilot couldn't adapt to flu peaks. We wanted a system that adapts live, shows its reasoning, and stops at the one thing software shouldn't guess: whose record is right.

**What it does.** Emer Flow has two screens.
- **The Hospital Swarm board:** 8 department agents on Gemini 3.6 Flash (ER, ICU, Step-down, Surgery, Staffing, Imaging, Blood bank, EMS), each with its own persona, negotiate with a coordinator agent. They ask each other questions directly, object to plans, and agree a plan every few minutes. Every patient row shows what's wrong, what they need, where they're going and who decided.
- **DeepChart,** the doctor's portal: when a move relies on a fact the records disagree about, the move is paused and the doctor sees both records side by side, with sources and dates, then decides.

Everything is logged and exportable.

**How we built it.** Python and FastAPI. It uses a simulated hospital with 9 units, nurse ratios, a CT queue, blood stock and surgery, driven by a clock. The agents run on Gemini 3.6 Flash on Google Cloud Vertex AI, with structured JSON output, timeouts and a circuit breaker. Rule-keepers in code do the rest: the fast lane, the validator, the records check and the escalation ladder. The front end is React and Vite with a live Server-Sent Events stream. It's deployed on Cloud Run. Every live Gemini run is recorded, and replay mode plays one back for a reliable demo.

**Challenges.**
- **Latency:** 8 departments in parallel plus a coordinator takes 10–25 s per round, so the code places obvious cases instantly and the AI handles only contention.
- **Plan quality:** the coordinator made invalid moves until code handed it a menu of what's allowed for each patient.
- **Held beds** had to stay reserved until a human decides.
- **The critical-patient rule:** a critical patient must never wait on paperwork.

**Accomplishments.**
- The agents genuinely argue. For example, the ICU objected that a plan left no reserve bed.
- It caught ⟨X of Y⟩ planted record mistakes before a patient moved.
- No critical patient waited for a bed.
- There's a full audit trail.

**What we learned.** The AI is most useful as a negotiator and explainer. Hard rules belong in code, and the most important feature is knowing when to stop and ask a human.

**What's next.**
- Read the hospital's real bed-tracking and scheduling feeds (read-only).
- Pull outside records through a health-information exchange.
- Pilot in shadow mode alongside a real bed-management team.

**Built with:** Gemini 3.6 Flash, Google Cloud Vertex AI, Cloud Run, Python, FastAPI, React, Vite, FHIR-style records, Synthea-style synthetic patients.

## Submission checklist
- [ ] Record the final demo tape: `EMERFLOW_MODE=live`, reset, Bus crash at about minute 3, run about 6 rounds, then `python -m backend.agents.tape pick <file>`
- [ ] Fill in the ⟨numbers⟩ above from `/api/results` and `/api/deepchart/score`
- [ ] Deploy: `PROJECT=hop-hacks-509103 GCLOUD=~/google-cloud-sdk/bin/gcloud ./deploy.sh` and paste the URL
- [ ] Wifi-off test: `EMERFLOW_MODE=replay`, pull the network, run the whole demo
- [ ] Record a 2-minute backup video of a clean run
- [ ] Slides (5): the problem, the demo, the numbers, safety, the path to real hospital data
- [ ] Rehearse the 90 seconds out loud, 10 times, with both people
- [ ] Devpost: paste the text above, add the video, repo link and live URL
