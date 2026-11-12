# Mobile polish — design

**Date:** 12 November 2026
**Branch:** `integration`, built on `outlet-visits` (PR #8), plus `hr-gate-guard` (PR #9) and `origin/frontend/live-tracker-updates`.

## Goal

Make the app look and work well on a phone, starting with the screens employees use. The current look stays: the frontend developer's colours, fonts and style. What changes is that it now works properly on a phone.

## Decisions

| # | Decision |
|---|---|
| 1 | **Merge first, then polish.** The frontend branch (`frontend/live-tracker-updates`) redesigned much of the app and isn't merged with the backend work. The polish goes on top of a combined branch, so it applies to the real final screens. |
| 2 | **Employee screens get the full treatment.** The HR portal only needs to be usable on a phone. |
| 3 | **Keep the look, fix mobile.** There are no colour, font or style changes. |
| 4 | **The approach is a shared mobile layer, then per-screen fixes.** One stylesheet holds the rules every screen needs; each screen gets its own small fixes. |
| 5 | **Mobile layout is checked automatically.** A headless browser (Playwright, as a dev tool only) opens each screen at phone sizes. The check fails if a page scrolls sideways or a control is too small to tap. It also saves before and after screenshots. |

Out of scope:
- new features;
- colour, font or brand changes;
- connecting the frontend's screens (live tracker, visit lists, reports) to the new backend endpoints, which is the frontend developer's job;
- background location (native app).

## Part 0: integration

1. On `integration`, merge `hr-gate-guard`, then `origin/frontend/live-tracker-updates`.
2. Resolve the two clashing files, keeping both sides in each:
   - `src/components/hr/EmployeeDirectory.jsx`: HR's **Add employee** button and the *Face not set up* badge from the backend side; the leave, category and leave-modal additions from the frontend side.
   - `src/styles/employee-directory.css`: both sides' rules.
3. Check the files that merged without conflict but that both sides changed, starting with `src/App.jsx`. Every route from both sides must still work:
   - backend: `/enroll/:token`, `/hr/setup/:token`, `/hr/reset/:token`, `/visit`;
   - frontend: `/privacy`, `/tracking-policy`, `/terms`, `/cookies`, the location sharing bar;
   - shared: `/verify/:token`, `/display`.
4. All unit tests pass, `vite build` succeeds, and the backend smoke scripts are unaffected (no backend file changes beyond the merge).

**The two location features don't conflict.** The frontend's `LocationSharingBar` still uses its own browser-only tracking service; the backend's tracking token is saved by the check-in page for visits. Connecting the bar to `POST /tracking/points` is out of scope.

## Part 1: the mobile check

A dev-only script, `scripts/mobile-check.mjs`, uses Playwright (`@playwright/test` as a devDependency, Chromium only).
- **It runs against** `npx vite preview`, or the dev server when one is already running.
- **It covers two sizes,** 360×800 (small Android) and 390×844 (iPhone 14), using touch emulation.
- **It loads each screen** in the list below. For screens that need data, it answers the API calls with fixed sample responses (`page.route`), so every state can be shown without a backend: a check-in lookup, a scan result, a visit list, an enrolment link, a verification link, an invite, a reset link, and HR sign-in states.
- **It fails when, on any screen or state:**
  - the page scrolls sideways (`document.documentElement.scrollWidth > window.innerWidth + 1`);
  - any visible button, link or input in the main content is smaller than 44×44 CSS px (inline text links inside paragraphs are exempt);
  - any visible input has a font size below 16 px, which makes iPhones zoom in.
- **It saves screenshots** to `mobile-screenshots/<size>/<screen>.png`. That folder is git-ignored and is shared with the user as before and after.
- **It prints** one `pass` or `FAIL` line per screen, state and size, and exits 1 on any failure.

### Screens

**Employee screens (full treatment):**
- Home `/`;
- registration `/register`: welcome, personal details, job position with the shop picker, face capture, review, success;
- check-in `/attendance`: Staff ID, camera scan, mismatch error, success with **Record a visit**;
- **Record a visit** `/visit`: no session, shop list, other outlet, saved;
- face setup `/enroll/:token`: valid link and closed link;
- SMS verification `/verify/:token`;
- HR invite `/hr/setup/:token` and password reset `/hr/reset/:token`;
- the location sharing bar, in each of its states;
- policy pages `/privacy`, `/tracking-policy`, `/terms`, `/cookies`;
- the install card;
- the workplace display `/display`, which runs on a tablet, so it gets the overflow check only.

**HR portal (usable):**
- sign-in and authenticator screens;
- after sign-in, using sample data: dashboard, employees, attendance, live tracker, settings.

## Part 2: the shared mobile layer

`src/styles/mobile.css` is imported once in `main.jsx` after the other global styles. It works through the existing class names and design tokens, with no new colours. The rules apply at up to 640 px unless stated otherwise:

- **Inputs:** `input, select, textarea` get `font-size: max(16px, 1em)`.
- **Tap targets:** `.btn` and form controls get a minimum height of 44 px. Icon buttons get at least 44×44.
- **Notch and home bar:** page shells use `padding: max(16px, env(safe-area-inset-*))`. `index.html` gets `viewport-fit=cover` added to the viewport tag.
- **No sideways scroll:** `html, body { overflow-x: clip }` is a safety net, not the fix. Each screen's real cause is fixed in Part 3. Long words and IDs wrap with `overflow-wrap: anywhere`.
- **Action bar:** `.step-actions` and `.success-actions` stick to the bottom of the screen with a solid background and the safe-area padding. The primary button is full width and the secondary one sits above it.
- **Cards:** cards drop their outer margins on a phone and keep 16 px inner padding.
- **Type:** body text is at least 15 px and line height 1.5. Headings scale with `clamp()`.
- **Images and media:** `img, video { max-width: 100% }`. The camera frame (`.scanner-frame`) fills the width at a 3:4 ratio.
- **Pop-ups:** `.modal`-type dialogs fill the screen, scroll inside, and keep a sticky header and actions. The names come from the existing modal classes, found during implementation.
- **Tables:** wide tables sit in a box that scrolls sideways on its own (`.table-scroll` added where needed), so the page doesn't.
- **Motion:** `prefers-reduced-motion` turns off the scan animations.

## Part 3: per-screen fixes

For each screen in the list, run the check, read the screenshot, and fix the actual causes in that screen's own stylesheet or markup. The look stays the same. Expected issues to look for:
- fixed widths;
- shop pickers and step indicators that don't wrap;
- long staff IDs or links;
- buttons placed side by side that should stack;
- small icon buttons;
- text crammed against the screen edge;
- the camera preview shrinking;
- the location bar covering content.

**The HR portal pass:**
- below 900 px, the side menu folds into a menu button that opens a drawer, if it doesn't already;
- page headers wrap;
- tables scroll inside their box;
- filter bars stack;
- pop-ups fill the screen.

Only the check's failures and clear visual problems in the screenshots are fixed; the HR portal is not redesigned.

## Testing

- **Before:** the mobile check is run first and fails, and the failures are recorded. The before screenshots are kept.
- **After:** every screen, state and size passes, and the after screenshots are taken.
- `npx vitest run` passes and `npx vite build` succeeds.
- `npx oxlint` shows no new findings beyond the known browser-global false positives.
- A short visual report (an artifact page with before and after images side by side) is shared with the user.
