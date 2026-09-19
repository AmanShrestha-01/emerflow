# EmerFlow — the 2-minute pitch (current script)

HopHacks 2026. Two speakers. Everything below is what you actually say; **[brackets]** are what happens on screen.
Replaces the 90-second script in `emerflow-pitch-and-devpost.md`, which still assumes the records check runs
inside the Swarm (it is off by default now).

**The idea in one line:** the map finds the beds, the Swarm makes the beds.

---

## Before you walk up (5 minutes of setup)

1. Restart the backend, then **sign in again** (a restart logs everyone out).
2. Tab 1: the map (the front page, `/`). Check the header says **live ER status from MIEMSS**.
   If it doesn't, the venue wifi is blocking the feed: do not say the word "live" about the other hospitals.
3. Tab 2: the board (`/board`), signed in, **speed 1×**.
4. On tab 2, click **Bus crash**. The agents start meeting while you talk over the map.
   (Or run the map's **Run the crisis demo** and hand its 11 patients over live — see "The handoff" below.)
5. Switch to tab 1. Breathe. Start.

**Who says what:** A drives the laptop and narrates the screen. B opens, closes and handles questions.

---

## The script (about 300 words, two minutes at a calm pace)

**B — [0:00, tab 1: the map]**
> "It's 9 p.m. A bus crashes in Baltimore. Twenty-five people are hurt. The first question isn't medical.
> It's: where do they go?"

**A — [0:12, point at the map]**
> "This is every emergency room in Baltimore, live from MIEMSS, Maryland's own EMS system: how crowded each
> ER is, and how many ambulances are sitting at its door right now. A crew sees the nearest ER **with room**,
> not just the nearest ER. For a crash this size they can't all go to one hospital, so the map spreads them:
> critical cases to a trauma centre, the rest to ERs with space. Eleven are coming to us: the Johns Hopkins row
> here is our own hospital simulation, standing in for a large academic ER."

**B — [0:35]**
> "But in a crisis, every ER on this map says full. A map can't create a bed.
> That's the other half of what we built."

**A — [0:42, switch to tab 2: the board, agents already talking]**
> "Inside the hospital, freeing one ER bed is a chain. The ER patient moves up to intensive care, but only if
> intensive care moves someone to the close-watch beds, who moves someone to the ward, who sends someone home.
> Five departments. Today a nurse supervisor does that by phone, one call at a time, while ambulances queue."

**A — [1:00, point at the AI chat]**
> "We gave every department its own AI: the ER, intensive care, surgery, the lab, X-ray, ten in all. They're
> negotiating that chain right now, in the open, and you can read every word."

**A — [1:12, the cards move]**
> "The plan lands and patients move. But the AI never counts a bed. Our code checks every single move: is
> there a nurse for it, are the tests back, is it the right kind of bed?"

**A — [1:25, the approval card → click Yes]**
> "And the big steps wait for a human. Calling in nurses, postponing surgery, diverting ambulances.
> The AI suggests. A person decides."

**B — [1:35, A switches back to tab 1: the map]**
> "And every bed the Swarm frees shows up here for the next ambulance."

**B — [1:45]**
> "In our simulations of this crash, a hospital where every department fends for itself left patients waiting
> up to two hours for a bed. Coordinated: twelve minutes."

**Both — [1:55]**
> "The map finds the beds. The Swarm makes the beds.
> **AI talks. Code checks. A human decides.** That's EmerFlow."

---

## The handoff (optional, when you want map and board to be one story)

On the map, click **Run the crisis demo**, then the card that says "11 of the 40 casualties are assigned to
Johns Hopkins Hospital" → **Send them to the hospital board**. Those eleven arrive on the board as unidentified
casualties (all named X, as they would be in a real mass casualty). Then press **Bus crash** on the board if you
want a bigger wave behind them.

## If something goes wrong (say these, keep moving)

| What happens | What you say |
|---|---|
| No approval card by 1:25 | "Big steps, like calling in nurses, wait here for a person." Point at **Big decisions**, move on. |
| A **diversion** card appears | Click Yes: "One click, and the map stops sending ambulances to us." (Strongest moment; a bonus, never wait for it.) |
| The AI round is slow | "That's ten agents and a live model thinking. The rules have already placed the critical patients." |
| MIEMSS feed unavailable | Say "every ER in Baltimore, with public CMS data" and skip the word live. |
| Everything breaks | Switch to the recorded demo video and narrate the same script. |

---

## Questions and answers (short versions; the first sentence is the answer)

**"Does the AI actually do better than plain rules?"**
> Not proven, and we won't claim it. Our comparison runs the agents offline, where they fall back to the same
> rules, so both arms match. The measured win is coordination itself: 18 minutes average wait down to 1.
> What the AI adds is a negotiation a human can read and approve, and code guarantees it can never do worse.

**"Where does the hospital data come from?"**
> Today the hospital is simulated, and we label it. In production we read the admit-discharge-transfer feed
> every hospital already sends through its interface engine, in HL7 or FHIR. Only the input changes; the
> agents and the safety rules stay the same.

**"What's actually live on the map?"**
> Crowding levels and ambulance counts, from MIEMSS EDAS, refreshed at most once a minute. Bed counts and
> waits are estimates from CMS data. Our own hospital is fictional and live from our simulation. The page
> says which is which.

**"Who uses this in a hospital?"**
> The house supervisor or charge nurse, on one screen. They go from fifty phone calls to a few yes-or-no
> decisions. Each unit's nurses get a handoff list: who is coming, who left, who could move on next.

**"Isn't it dangerous to let an AI move patients?"**
> The AI never moves anyone. It proposes a unit. Code checks it against the hospital's rules: nurse ratios,
> the right kind of bed, tests back, severity. If a rule says no, the move dies. Life-saving destinations
> are never blocked, and big actions need a human.

**"What if the model is down or the wifi dies?"**
> Every agent has a rule-based fallback, and the board keeps running. We can show you: it runs the whole
> demo offline.

**"How is this different from what Hopkins already has?"**
> Hopkins has a command center: a room, screens and staff, built with GE. It works, and almost no other
> hospital can afford it. We're the same coordination as software, and we add the part a command center
> doesn't have: agents that explain their reasoning in plain words.

**"What about patient privacy?"**
> Every patient in the demo is synthetic. We plant the record conflicts ourselves so we can measure whether
> we catch them. A real deployment needs the hospital's own sign-on and a HIPAA agreement.

**"What's the business?"**
> A subscription per hospital, sold to hospital operations. The first customers are community hospitals
> that can't afford a command center. The map is how they share status with EMS, which is also how we get
> in the door.

**"What did you build this weekend?"**
> All of it: the simulation, ten Gemini agents with a coordinator, the rule checker, the approval flow,
> the live MIEMSS map, and DeepChart, a doctor's view that flags when two hospitals' records disagree
> about the same patient.

**"What's next?"**
> A read-only pilot on one unit: EmerFlow suggests, staff compare, nobody has to trust it yet. Then measure
> whether the agents beat the rules on real data, which is the number we don't have today.

---

## Lines worth memorising

- "The map finds the beds. The Swarm makes the beds."
- "Every ER on this map says full. A map can't create a bed."
- "The AI never counts a bed."
- "AI talks. Code checks. A human decides."
- "Hopkins built a room for this. We built it for every hospital that can't."

## Say once, early

"Every patient and bed in our hospital is simulated. Hospital names are for illustration; we are not affiliated
with these institutions." The same line is printed on the map and the board.

## Never say

- That the Swarm beats the rules on wait times (unmeasured).
- That any real hospital's bed numbers are live (only crowding and ambulance counts are).
- Anything clinical: EmerFlow assigns beds, it never advises care.
