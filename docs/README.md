# Emer Flow docs

The API and event shapes are in [`../CONTRACT.md`](../CONTRACT.md). How to run things is in [`../README.md`](../README.md).

## Pitch and judging
| File | What it is |
|---|---|
| [`pitch/two-minute-pitch.md`](pitch/two-minute-pitch.md) | **The script we present from**: 2 minutes, two speakers, setup, fallbacks, judge Q&A |
| [`pitch/emerflow-pitch-and-devpost.md`](pitch/emerflow-pitch-and-devpost.md) | The whole product: pitch, demo script, Devpost write-up |
| [`pitch/deepchart-pitch.md`](pitch/deepchart-pitch.md) | DeepChart demo script and judge Q&A |

## DeepChart (the records check and doctor portal)
| File | What it is |
|---|---|
| [`deepchart/spec.md`](deepchart/spec.md) | Product spec: cross-hospital lookup, merged chart, order warnings, login, patient link |
| [`deepchart/legal.md`](deepchart/legal.md) | Can we build it? HIPAA, Maryland (CRISP, MHCC), Part 2, FDA, patient link, real hospital names. Research, not legal advice |
| [`deepchart/build-plan.md`](deepchart/build-plan.md) | Build tasks, with notes on where the build differs from the plan |

## Demos and screenshots
| File | What it is |
|---|---|
| [`demos/twenty-patients-simulation.html`](demos/twenty-patients-simulation.html) | A recorded 20-patient run, as a standalone page (the run is recorded with `tools/record_twenty_patients.py`) |
| [`screenshots/`](screenshots/) | Board and dashboard screenshots |
| [`screenshots/deepchart/`](screenshots/deepchart/) | The DeepChart demo, one screenshot per step (recorded with `tools/record_deepchart_demo.cjs`) |

## Archive
[`archive/concord/`](archive/concord/) holds the planning docs for the earlier "Concord" design (PRD, design spec, NotebookLM explainers, visual
explainer). They're background only. Where they disagree with the code, the code and `CONTRACT.md` win.
