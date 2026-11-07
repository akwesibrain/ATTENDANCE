# Workforce Attendance — Redesign Direction

## Brief (self-authored)

**What it is, and who it is for.** A web app (not a marketing site) for two
companies — Box For Less and Double A. Two daily users:

- The **employee** (often on a phone, at the door, in a hurry): register once,
  then check in and out with a Staff ID and a face scan.
- The **HR manager** (at a desk, all morning): see who is in, who is late, who
  is absent, and how many days each person has worked.

**The one job.**
- Employee: *prove it is me and record my attendance in under ten seconds.*
- HR: *see today's attendance at a glance and trust it.*

**Three words for how it should feel.** Trustworthy. Calm. Precise.

**References from outside the web.** A time-clock punch card and a hospital
wristband — objects whose whole job is to be read correctly at a glance, where
legibility and an unambiguous state are the entire design.

**What exists.** Real brand assets: two company logos (Box For Less on dark
navy, Double A on white), the "WA" Workforce Attendance mark, an established
white-and-blue palette, Inter already loaded. Real behavior: a 4-step
registration wizard with face enrollment, a Staff-ID + live-face attendance
flow with strict time windows and anti-cheat, and an HR dashboard. All of this
is preserved.

## Current (the redesign audit)

The current look is competent but generic — it wears **face 3, "The shadcn
Dashboard"**: a 248px sidebar with outline icons, a top bar with a bell and
avatar initials, and a row of KPI cards with sparklines as the first thing HR
sees. The registration landing wears parts of **face 1, "The Paper Edition"**
(a pill badge, a checklist, a features strip of three icon cards). Inter is a
default-reach font used unexamined. Everything sits in white rounded cards on a
grey ground — boxes inside boxes.

**What works and must survive (the keep list, a contract):**
- Both company logos and the WA mark.
- The white-and-blue identity (it is the companies' real color).
- Every route (`/`, `/register`, `/attendance`, `/hr`), every user flow, all
  validation, the face-enrollment capture and flip, the face-to-Staff-ID match,
  the time windows (check-in 6–9am, late after 9; check-out 5–7pm), the
  one-check-in/one-check-out rule, and the 5-failed-attempts → ABSENT
  anti-cheat rule. None of this logic changes.
- The mock services and localStorage data handling, untouched.

**Slop to lose:** the KPI-card row as the hero of the dashboard, the sparklines
that carry no real data, the pill badge, the three-icon features strip, boxes
inside boxes, and status shown by hue alone.

## The category default we refuse

HR/attendance SaaS defaults to a navy sidebar + a grid of pastel KPI cards +
Inter everywhere + six status colors. We keep the companies' blue but refuse
the KPI-card-hero and the six-hue status confetti. State is shown by **word and
shape first, hue only for what needs action**.

## Concept

**Workforce Attendance is a time clock.** Not a dashboard of charts — a
trustworthy instrument. The employee's screen is the punch: one clear action,
one clear result. HR's screen is the day's register: who is in, who is late,
who is absent, readable like a punched card. The design borrows the punch
card's discipline — strong tabular numbers, unambiguous status words, generous
whitespace, one ink, one accent — and the wristband's rule that the most
important fact is the loudest.

## Tokens

**Ground (light only; no dark mode — say so):** a cool paper-white
`#f6f9fd` (the blue-tinted light of a registration office), card surface pure
white `#ffffff`, ink a deep navy-ink `#0e1f3d`, secondary ink `#51637f`
(still ≥4.5:1), hairline `#e2eaf4`.

**Accent — one, one job:** the companies' action blue `#1c6fe0`, used only for
the primary action and "needs you now" (focus, selected, the live scan). Deep
brand navy `#0b3d91` is the structural ink of headers and the HR sidebar, not a
second accent.

**Status (four states, hue + word + shape, never hue alone):**
- On time / present → positive green `#1a8a4a` (soft `#e5f4ec`)
- Late → attention amber `#b8770e` (soft `#fbf0da`)
- Absent / error → critical red `#c43d3d` (soft `#fae9e9`)
- Info / neutral → the secondary ink, no hue

**Type.** One family, chosen on purpose: **Public Sans** — a neutral
neo-grotesque drawn for US government forms, because this product *is* a form
and a register; it stays legible at small sizes and its tabular figures align
times and Staff IDs in columns. (Inter is the default reach; Public Sans is the
same voice with a reason.) A mono for data: **IBM Plex Mono** for Staff IDs and
times, so `BFL-0001` and `6:46 AM` read as instrument readouts.

Scale (app, fixed text steps, fluid display):
`--t-display: clamp(2.25rem, 1.4rem + 3vw, 3.5rem)` (landing headline),
`--t-h1: 1.5rem`, `--t-h2: 1.25rem`, `--t-body: 1rem` (16px),
`--t-small: 0.9375rem` (15px), `--t-meta: 0.8125rem` (13px, the floor).

**Radius family (mixed by role, nesting concentrically):** `--r-sm: 8px`
(inputs, chips), `--r-md: 12px` (cards), `--r-lg: 18px` (the one floating
panel), `--r-pill: 999px` (badges, the scan frame). **Shadows only on what
floats:** one card shadow, one raised shadow for the dialog/scanner.

**Spacing scale:** 4, 8, 12, 16, 24, 40, 64, 104.

## The shell and density (app)

- **Employee flow** (phone-first): a single centered column, one action per
  screen, big touch targets (≥44px), the camera the hero of the scan step.
- **HR dashboard**: keep the sidebar shell (many sections, desk tool) but make
  the **work own the screen** — today's attendance register is the first and
  largest thing, not a KPI row. The day's numbers become one quiet summary
  line; the table is the hero. Sidebar collapses to a top bar on mobile.

## The signature (one moment, born from the concept)

**The punch.** When a face verifies and attendance records, a status card
"stamps" onto the screen: it scales from 0.96 with a strong ease-out and a
single concentric ring pulses once around the status icon — the digital punch
of a time clock. Trigger: successful `recordAttendance`. Timing: 320ms
`cubic-bezier(.2,.8,.2,1)` entrance + one 600ms ring pulse. Reduced-motion:
the card appears with no scale and no ring. Everything else is calm; UI
feedback stays 120–200ms; nothing loops, nothing marquees.

## Voice

Plain, specific, no marketing words. "Checked in at 6:46 AM" not "Great job!"
No em dashes; commas and periods. Sentence-case headings.

## States to design (per screen)

Loading (skeleton after 300ms, not a bare spinner), empty (first run and
filtered), error (plain words + retry, keep input), the anti-cheat
marked-absent state, the late-coming notice, and the time-window-blocked
state. All reachable and styled.
