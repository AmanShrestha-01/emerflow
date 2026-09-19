# Two Healthcare AI Projects, Explained Plainly: Hospital Swarm Commander and DeepChart

This document explains two software project ideas in ordinary language. No medical
or programming background is needed. Part A covers the first idea, Part B covers
the second, and Part C compares them and explains why combining them works.

---

# PART A: HOSPITAL SWARM COMMANDER

## A1. The problem

A hospital has a fixed number of beds. On a busy night, more people need them than
there are beds available. Someone has to decide who goes where.

That sounds like a simple queue, but it is not, because in a hospital everything
depends on everything else. Here is a real example of the tangle.

A man arrives at the emergency room with chest pain. He needs an intensive care
bed. There is exactly one left.

However, there is already a patient in intensive care who has improved enough to
move to a quieter floor. Moving her would free the bed. But the quieter floor has
no nurse available for another twelve minutes, and its rules require a nurse to be
present to receive a patient.

Meanwhile, a surgery finishing in forty-five minutes will produce a patient who
will definitely need an intensive care bed.

So the question "can this man get the intensive care bed?" actually depends on a
nurse's shift schedule, a surgery happening in another building, and a discharge
decision about a completely different person. Change any one of those and the
answer changes.

## A2. Why this goes badly in real hospitals

Every department is run by someone making sensible decisions about their own
department. And this is the deep problem: everyone behaving sensibly on their own
produces a bad result overall.

The intensive care nurse protects her last bed. If she gives it away and someone
crashes an hour later, she has nowhere to put them. That is correct, careful
thinking on her part.

The consequence is that the man with chest pain waits six hours in a hallway.

If everyone had coordinated - move the recovered patient, tell the quiet floor to
expect her in twelve minutes, free the bed - everyone would end up better off. That
coordination does not happen, because no single person can see the whole hospital
at once. There is no such job. And even if there were, no human could hold all of
it in their head during a crisis.

That gap is what Hospital Swarm Commander claims to fill.

## A3. What the project is

Two things.

**A simulated hospital.** Sometimes called a digital twin. It is a model of a
hospital held in a computer: how many beds each unit has, how many are occupied,
which nurses are on shift, whether the scanners are free.

**A small program for each department.** Each one looks at its own department and
reports what it wants. People call these "AI agents," but they are simply small
pieces of code with a narrow view.

The emergency room's program says: six patients are waiting, I need beds. The
intensive care program says: one bed left, critical patients only. The staffing
program says: no nurse available for twelve minutes.

Then one more piece, a coordinator, reads all of those reports and decides what
actually happens.

## A4. The pieces in detail

**The hospital state.** Structured data describing the hospital: bed counts per
unit, who is in which bed, which staff are on shift and when shifts change,
nurse-to-patient ratios, equipment availability, and supplies such as blood by
type. Blood type O-negative matters particularly, because it can be given to
anyone and therefore runs out first in a crisis.

**The patient generator.** This invents patients arriving. Each one needs an
arrival time, a severity, a list of what they require, and how long they will
require it.

Arrival times matter more than people expect. Real emergency room arrivals follow
a pattern that statisticians call a Poisson process: random, but with a predictable
average rate that changes by hour and by day. A Monday morning looks nothing like
a Saturday at two in the morning. If this generator is unrealistic, everything
downstream is meaningless, because the impressive results describe a hospital that
could not exist.

Severity uses a real five-point scale used in actual emergency departments, where
one means dying right now and five means the person could have gone to a pharmacy
instead. Most real patients are threes.

**Discrete-event simulation.** This is a clever idea worth understanding.

The obvious way to simulate time is to advance one second at a time and check what
changed. Simulating a full day that way means over eighty thousand steps, and
almost every one of them is "nothing happened."

Discrete-event simulation instead keeps a list of future events sorted by time,
and jumps directly to the next one. A patient arrives at 9:14. Nothing will happen
until a scan finishes at 9:31, so jump there. Nothing until a shift change at
9:47, so jump there. Twelve hours of hospital activity might be four hundred
events instead of forty-three thousand ticks. A week can be simulated in seconds.

There is a catch that causes real trouble. This technique is designed for running
a simulation as fast as possible and reading the results afterward. A live
demonstration needs the opposite: the simulation running at human speed, on a
screen, while someone interacts with it. Those are conflicting requirements, and
bridging them is genuinely fiddly.

**The department programs.** Each has a view of its own unit, a goal, and
restrictions it cannot break.

The emergency room's goal is to reduce how long patients wait and how many leave
without being seen. Its restriction is that it cannot refuse anyone, because
American law requires emergency departments to screen everyone who arrives.

Intensive care's goal is to keep capacity available for the sickest patients. Its
restriction is a strict nurse-to-patient ratio, usually one nurse for every two
patients.

Staffing's goal is to avoid breaking those ratios and avoid forcing overtime. Its
restriction is that shift boundaries are fixed.

The important part is that these goals genuinely conflict with each other. The
emergency room wants intensive care to accept patients. Intensive care wants to
hold capacity back. That conflict is not a design flaw to be removed - it is the
actual situation in every hospital, and it is what makes the negotiation
meaningful rather than decorative.

**The coordinator.** Gathers every department's position and resolves it, usually
over a few rounds. First everyone states their situation. Then the coordinator
asks pointed questions, such as: intensive care, if the quiet floor could accept a
transfer in twelve minutes, could you take the emergency room patient now? Then it
commits to a plan.

**The optimizer.** This part is frequently misunderstood, so here it is precisely.

Suppose thirty-one patients need beds and twenty-seven beds exist, of different
types. Some patients can only go to certain units. Nurse ratios limit how many
each unit can accept. Some patients must be placed before others. The goal is to
minimize total waiting, weighted so that a critical patient waiting counts far
worse than a minor patient waiting.

That is a constraint satisfaction problem, and it is genuinely difficult. The
number of possible arrangements is astronomically large, so checking them all is
impossible. Specialized software searches cleverly, proving that entire regions of
possibilities cannot contain the best answer and skipping them.

Two things are worth knowing about this.

First, the difference between hard and soft restrictions. A hard restriction must
never be broken. A soft one is merely undesirable, with a penalty attached. If
everything is hard, the software will eventually report that the problem is
impossible - and that is the only thing it reports. It does not say which
restriction caused the impossibility. Diagnosing that without hints is extremely
difficult. Making restrictions soft means the software always returns something,
and problems can be diagnosed by looking at which penalties were paid.

Second, and importantly: large language models must not do this arithmetic. They
are poor at this kind of combinatorial calculation. Asked to assign thirty-one
patients to twenty-seven beds under six restrictions, a language model produces
something that looks plausible and is wrong - double-booked beds, violated ratios.
The correct division is that the AI reasons and explains, while specialized
mathematical software calculates.

**The dashboard.** Capacity bars for each department, a clock, key numbers such as
average wait and longest boarding time, a button to trigger a crisis, and ideally
a panel showing what the department programs are saying to each other, since that
is what makes the system feel intelligent rather than like a spreadsheet.

## A5. What the AI actually contributes

It does three things: convert messy situations into structured statements, produce
readable explanations of why a decision was made, and handle situations nobody
wrote a rule for.

It does not decide anything mathematical.

This is the structural weakness of the project. If someone asks what the AI adds
over simply running the mathematical software directly, the honest answer is
"explanation and flexibility." That is real but thin. The system would still
mostly work with the AI removed entirely.

## A6. What makes it hard to build

The simulation clock conflicting with the web server, as described above.

Injecting events into a running simulation. Simulation software generally has no
built-in way for an outside button press to interrupt a simulation in progress.
This requires deliberate design, and it is exactly what a crisis button needs.

Impossibility reported without explanation, as described above.

And a subtle one: to claim that average waiting dropped from eighty-one minutes to
forty-three, two different approaches must be built - a deliberately simple one
and the sophisticated one - then run on identical conditions and compared. Teams
routinely build only the sophisticated one and then have nothing to compare
against. There is a trap on the other side too: make the simple approach too
foolish and the comparison is rigged.

## A7. Strengths and weaknesses

Strengths: an excellent, dramatic demonstration. A serious real problem. Impressive
breadth of engineering.

Weaknesses: the AI is decorative rather than essential. The results cannot be
verified, because the hospital is invented, so of course the method works inside
it. And it is technically the riskiest kind of thing to build under time pressure.

---

# PART B: DEEPCHART

## B1. The problem

A person's medical history does not exist in one place. It exists in fragments held
by every organization that ever treated them, and nobody merges those fragments.
They simply accumulate.

## B2. Six reasons the fragments disagree

**Copying forward.** Doctors write notes by copying the previous note and editing
it. Studies covering over a hundred million notes found roughly half of all text
in hospital computer systems is copied from earlier notes. Copy-pasting rose from
about a third of text in 2015 to about half by 2020. A medication someone stopped
two years ago gets copied forward hundreds of times, and it looks current every
single time.

**No merging on transfer.** When one hospital receives records from another, it
usually attaches them as a separate document rather than reconciling them. Now two
versions coexist, and both appear equally valid.

**Updates do not travel backwards.** A specialist raises a dose from ten
milligrams to twenty. The family doctor's file still says ten. Neither file is
lying. One is simply stale, and nothing on the screen indicates which.

**Different coding systems.** The same medication appears under a brand name in one
system and a generic name in another. The same laboratory test has a national
standard code in one place and a local hospital code in another. Two records can
describe an identical fact and look completely different to software.

**Patient statements versus written records.** A patient says they take twenty
milligrams. The chart says ten. Both were written down. Neither is marked as more
trustworthy.

**Ruling things out.** The word "diabetes" appears in a chart because a doctor
wrote "tested for diabetes, ruled out." Software that extracts carelessly gives a
healthy person a diagnosis.

## B3. Why too much information is more dangerous than too little

This is the counterintuitive heart of the idea.

A doctor with too little information knows they have too little, and orders tests.

A doctor with seven hundred pages of contradictory information has no idea which
parts to trust - and critically, does not know that they do not know. The record
looks complete. Nothing flags the disagreements. With roughly eleven minutes per
patient, they read a fraction of it, and whether they happen to read the accurate
page or the stale page is largely chance.

## B4. Seven kinds of disagreement

Different kinds need different detection and carry very different risk.

**Different values.** The same thing with two numbers. Ten milligrams versus
twenty. Easiest to detect.

**Different existence.** One source records something, another does not mention it.
An allergy listed in one file and absent from another. This is the hardest case in
the entire field, discussed below.

**Different status.** Active versus discontinued. One source says a medication is
being taken, another says it was stopped. Dangerous in both directions: giving a
stopped drug, or withholding a needed one.

**Impossible timelines.** The values are individually fine but the sequence makes
no sense. A dose went from ten to twenty in January, and a February record says
ten. That is probably a stale copy rather than a reduction. Detecting this requires
reasoning about dates, not just comparing values.

**Different codes.** An identical fact written in two coding systems. This looks
like a disagreement but is not one, and it produces false alarms unless the codes
are translated to a common language first.

**Different people.** Are these even the same patient? Large hospital systems carry
duplicate patient records at rates between eight and sixteen percent. Merging two
different people's records creates a catastrophe.

**Negation.** "Diabetes" versus "diabetes ruled out." Requires understanding that
a word's meaning inverts based on the words around it.

## B5. The hardest problem in this field

Absence of evidence is not evidence of absence.

Source A records a penicillin allergy. Source B does not mention allergies at all.

Does that mean source B is asserting there is no allergy, which would be a real
contradiction? Or that source B never asked, which is merely a gap? Or that source
B asked, the patient said no, and nobody wrote it down, which is unknowable?

A computer cannot distinguish these from the data alone. And the stakes are
lopsided: missing a genuine penicillin allergy can kill someone, whereas a false
alarm merely causes unnecessary caution.

This is precisely why this cannot be built as a simple file comparison. Naive
comparison flags every missing field as a disagreement, buries the genuine ones in
noise, and gets switched off within a day of being deployed.

Real systems handle this using explicit denial. The standard format for medical
records has a way to record "asked about allergies, patient reports none" as
something different from silence. A disagreement counts only when one source
actively denies what another asserts. Handling this correctly is the difference
between a demonstration and a system.

## B6. The pieces in detail

**Reading the records.** The standard format for medical data is called FHIR. It
is structured, with one object type per kind of fact: patients, medication
requests, medication statements, allergies, conditions, observations, diagnostic
reports, visits. Notably, a medication request and a medication statement are
different things - what was prescribed versus what the patient reports actually
taking - and the gap between them is itself a finding.

**Translating to a common language.** Records cannot be compared until they speak
one language. There are national standard vocabularies for this: one for
medications, so brand and generic names collapse to a single identity; one for
laboratory tests; one for conditions. A practical obstacle: the full versions of
some of these require a free government license that takes about five business
days to approve, which is longer than a weekend.

**Turning documents into claims.** This is the key architectural move. Instead of
thinking in documents, think in claims. A claim is one atomic assertion with its
origin attached: this patient takes warfarin five milligrams, asserted by Hospital
B cardiology, dated February fourth, from this specific record. Every claim knows
where it came from. That is what provenance means, and it is what allows the system
to always show its evidence.

**Building a network instead of a pile.** Rather than a pile of text, the claims
form a network: patient connects to medication, which connects to a specific drug,
which connects to two competing dose values, each pointing back to its own source.
A network is the right shape because the useful questions are about relationships
and paths - show me every source that ever asserted anything about this medication,
in date order - which are natural in a network and awkward in a table.

**Specialist programs.** One for medications, handling doses, active or stopped
status, duplicate therapy, and brand versus generic identity. One for allergies -
the hardest, because of the absence problem, plus cross-reactivity, where an
allergy to one drug implies caution about related drugs. One for laboratory
results, where units and reference ranges matter enormously, because the same
number in different units is a different fact. One for diagnoses, handling
confirmed versus ruled out versus suspected. One for timelines, ordering everything
by date and spotting impossible sequences. And one that takes all of their output
and decides what is genuinely a disagreement.

The narrowness is the point. A program looking only at allergies, with
allergy-specific instructions, performs better than one general program looking at
everything, and its mistakes are traceable to a specific place.

**Retrieving evidence.** When a doctor asks why something was flagged, the system
pulls the actual supporting documents - the specialist's note, the prescription,
the pharmacy record, the patient's own statement - and grounds its explanation in
them rather than asserting things.

**The output, and the most important design decision.** The system displays that
records disagree, shows each version with its source and date, and requests
verification. It never states which value is correct.

That restraint is right on three levels. Factually, the software genuinely does not
know. Legally, software that issues a single clinical instruction in an urgent
situation may count as a regulated medical device requiring government approval.
Practically, a tool that guesses wrong once loses a clinician's trust permanently.

## B7. What the AI actually contributes

The core task is deciding whether two differently worded statements mean the same
thing or genuinely conflict.

Consider four phrasings: "Coumadin 5mg daily," "warfarin 5 mg by mouth once
daily," "on anticoagulation," and "patient anticoagulated, levels therapeutic."
The first two are the same fact under different names. The third and fourth are
consistent but vaguer. None contradict each other. Now add "no anticoagulants" -
that one contradicts all four.

No rule-based system does this reliably. It would require every synonym,
abbreviation, route, frequency and phrasing, specified in advance, forever.
Language models handle it well because judging whether two statements mean the same
thing is exactly what they are good at.

So unlike Hospital Swarm Commander, removing the AI from DeepChart stops the
project working entirely. That difference matters.

## B8. What makes it hard to build

No known correct answers. With real records nobody knows the truth, so accuracy
cannot be measured. This is why deliberately planting known disagreements and
keeping a written list is the right approach - it is the only way to produce a real
number.

The absence problem, described above.

Licensing delays on the standard vocabularies.

False alarms damage adoption faster than missed findings. A tool that cries wolf
gets switched off. A tool that surfaces three genuine disagreements gets used.

Practice data is too clean. Freely available synthetic patient records have tidy
histories that agree with each other, so pointing detection software at them finds
nothing.

## B9. Strengths and weaknesses

Strengths: the AI is genuinely necessary. Nothing can be faked, because the
evidence links either work or they do not. A measurable accuracy figure is
achievable. And it addresses diagnostic error and medication safety, areas with
enormous documented harm.

Weaknesses: a list of paperwork disagreements is a duller demonstration than a
hospital in crisis. And merely pointing out a problem is not the same as doing
something about it.

---

# PART C: COMPARING THEM

## C1. Side by side

Hospital Swarm Commander asks who goes where and when. DeepChart asks which
records can be trusted.

Hospital Swarm's data is invented by whoever builds it. DeepChart's data is in a
real format with real medical codes.

In Hospital Swarm, the AI explains and narrates. In DeepChart, the AI performs the
central task.

Remove the AI from Hospital Swarm and it mostly still works. Remove it from
DeepChart and nothing works.

Hospital Swarm's hardest part is the simulation clock and impossible-to-diagnose
mathematical failures. DeepChart's hardest part is the absence problem.

Hospital Swarm cannot be verified, because it is a self-contained invention.
DeepChart can be measured against planted known answers.

Hospital Swarm can easily be faked with a scripted animation. DeepChart cannot,
because anyone can click a finding and check its source.

Hospital Swarm's demonstration is excellent. DeepChart's is modest.

## C2. Why combining them works

Look at that comparison again. Each project's weaknesses are precisely the other's
strengths.

Hospital Swarm has the demonstration and nothing verifiable. DeepChart has
something verifiable and no demonstration. Hospital Swarm's AI is decorative;
DeepChart's is essential. Hospital Swarm can be faked; DeepChart cannot.

A combination is not two features side by side. The connection works like this: the
system deciding where a patient goes must declare which facts its decision relied
on. Then only those specific facts get checked across all of the patient's records
before the patient actually moves. If the records disagree about one of them, the
move is paused and a human is asked to resolve it.

This produces one idea rather than two. The crisis creates urgency and a
compelling demonstration. The record checking gives the AI something only AI can
do, and turns a flagged disagreement into a real consequence: a patient stops
moving until a person looks.

It also creates something neither project had alone. Existing work finds every
disagreement in a record, producing a long list nobody reads. Filtering to the
disagreements that are about to change a decision produces a short list that is
always worth reading.

---

# GLOSSARY

**Digital twin** - a model of a real system, such as a hospital, held in a
computer.

**Agent** - a small program with one narrow job. The word sounds larger than it is.

**Discrete-event simulation** - simulating time by jumping between moments when
something happens, rather than advancing second by second.

**Constraint satisfaction** - finding an arrangement that satisfies many
competing restrictions at once, such as assigning patients to beds.

**Hard and soft restrictions** - a hard restriction must never be broken; a soft
one is merely undesirable and carries a penalty.

**FHIR** - the standard format used to exchange medical records between systems.

**Provenance** - knowing exactly where a piece of information came from: which
file, which organization, which date.

**Claim** - one atomic assertion from a record, with its origin attached.

**Explicit denial** - recording "asked, and the answer was no" as something
different from silence. Essential to distinguishing a genuine disagreement from a
gap.

**Clinical decision support** - software that helps a clinician decide what to do.
When it issues a single instruction in an urgent situation, regulators may treat it
as a medical device.

**Synthetic patient records** - realistic but entirely fabricated medical records,
used for testing and research. No real person is involved.
