# DeepChart: pitch and judge Q&A

## The line
> Hospitals can already share records. Nobody checks them at the moment it matters.
> DeepChart checks only the facts a decision relies on, across every hospital's record,
> before the patient moves, and hands the disagreement to a human instead of guessing.

## 60-second demo script

Two laptops or two browser windows: **`/board`** (commander, Emer Flow General) and **`/doctor`** (the ER doctor).

| # | On screen | Say |
|---|---|---|
| 1 | Board: press **MASS CASUALTY** | "A bus crash. 25 patients hit Emer Flow General at once." |
| 2 | Board: MC-03 turns amber, **HELD for ICU** | "The swarm wants MC-03 in ICU. DeepChart paused it, because the move relies on 'no blood thinner'." |
| 3 | Doctor: pick the held patient from the list, reason **Treating in the ER**, **Look up other hospitals** | "The ER doctor pulls her records from every hospital that has them." |
| 4 | Doctor: Hospital B **STRONG**, Hospital C **POSSIBLE** | "Two matches. Hospital C has the same name and birthday, but a different phone number. We don't merge that. The doctor decides." Click **No** on C. |
| 5 | Doctor: merged chart, **anticoagulant ⚠ CONFLICT** | "Hospital B's cardiology record from March says warfarin, active. Today's intake says none. We don't say which is right. We show both, with dates and sources." |
| 6 | Doctor: order "start heparin drip", ticks anticoagulant → **VERIFICATION REQUIRED** | "The order relies on that same fact, so it gets flagged. It doesn't block the order, and it doesn't tell the doctor what to do." |
| 7 | Doctor: types reason, **I have reviewed** → resolves hold **Proceed** | "A human resolved it, and the reason is logged." |
| 8 | Board: MC-03 moves to ICU live | "The bed move goes through on the commander's board." |
| 9 | Phone: patient link | "And Lena can see exactly who opened her record, and why." |

**Optional opener for step 3:** log in as Hospital B in a second tab, then **Transfer to Emer Flow General**. The patient shows up
in the ER doctor's *Incoming transfers* with one conflict already flagged.

**Close:** "We planted every conflict ourselves and kept an answer key. After a 25-patient surge, DeepChart flagged
11 of 11 record conflicts with no false alarms, and showed all 11 lookalike patients as 'possible', never 'strong'."
These numbers come from `GET /api/deepchart/score` (seed 7, one surge). **Say the honest part too:** the check is plain code
run against conflicts we planted, so 100% shows it works as designed. It isn't a claim about real-world records.

## Judge questions

**"Epic already does this."**
Epic's Care Everywhere and the national networks *move* records, and Epic has a screen for merging outside
medication lists into your own. They don't check the records at the moment of a decision against the specific facts that decision
depends on, and they don't pause a bed move in a surge. We sit on top of record sharing. We don't replace it.

**"Isn't this a medical device?"**
Under FDA guidance, software that gives a single clinical instruction for a time-critical decision
looks like a device. DeepChart never does that. It says "these sources disagree; a human must
resolve this" and shows both. Warnings don't block, and it never names a correct value or a dose.

**"What about privacy?"**
All patients are synthetic. In the product, a doctor must pick a reason before any outside record opens (break-the-glass), every
lookup is logged, and the patient can see that log. Under HIPAA, sharing records between hospitals for treatment is generally
permitted. A real deployment would plug into the hospital's single sign-on (SSO) and a real record-exchange network. That's out of scope for this weekend.

**"How do you know it works?"**
We plant known conflicts (existence, status, value) and a lookalike patient, and we write an answer key.
We report precision and recall for each kind. In stub mode it's deterministic code, so the numbers can be reproduced.

**"What happens with a wrong patient match?"**
Hospitals have 8 to 16 percent duplicate records, so we never merge automatically. A possible match
shows up as its own conflict ("same person?"), and linking needs a click that goes in the log.

**"Why not just use an AI to read the whole chart?"**
AI is used on the board, where the department agents talk things through. The records check is plain code on purpose.
It compares declared facts across sources, so it's reproducible, measurable, and it can't make up a conflict.

**"Does it check drug interactions?"**
No. Existing record systems already do that with licensed drug databases. DeepChart catches places where the *records
disagree with each other*, which those systems don't catch.

## Words to avoid on stage
- "DeepChart knows / decides / recommends"
- "The correct record is…"
- "Prevents medical errors" (say "surfaces disagreements before a decision")
- "Real patient data"
