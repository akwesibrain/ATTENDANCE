# Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First merge the frontend branch with the backend branches. Then make every employee screen work well on a phone, and the HR portal usable on one, without changing the look.

**Architecture:**
- **Integration:** one merge commit combines `hr-gate-guard` and `origin/frontend/live-tracker-updates` into `integration`.
- **Mobile check:** a dev-only Playwright script loads every screen and state at two phone sizes, with sample API answers. It fails on sideways scrolling, small tap targets and inputs under 16 px, and saves screenshots.
- **Mobile layer:** a shared `mobile.css` fixes what every screen needs.
- **Per-screen fixes:** each screen's own stylesheet fixes what the check and the screenshots show.

**Tech Stack:** React 19 with Vite, plain CSS, `@playwright/test` (devDependency, Chromium only) and vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-mobile-polish-design.md`

## Global Constraints

- **No look changes:** no new colours, fonts or brand changes. Use the existing CSS custom properties and class names.
- **Phone sizes checked:** 360×800 and 390×844, with touch emulation.
- **Rules the check enforces:**
  - no sideways scroll (`scrollWidth > innerWidth + 1` fails);
  - visible buttons, links (except inline links in text) and inputs at least 44×44 CSS px;
  - visible inputs, selects and textareas with a computed font size of at least 16 px.
- **Where the rules apply:** mobile rules apply at a maximum width of 640 px, and the HR portal's menu folds below 900 px.
- **Backend:** no backend or migration changes; the smoke scripts must still pass unchanged.
- **Screenshots:** they go to `mobile-screenshots/`, which is git-ignored.
- **Commands:** `npx vitest run`; `npx vite build`; `npx oxlint -D no-undef src` (ignore the known browser-global false positives); `node scripts/mobile-check.mjs [--only <screen>]`.

## Review Focus

1. **The on-screen keyboard:** when a text box at the bottom of the screen is focused, the sticky action bar must not cover it. Test this by focusing the last field on each form at 360×800 and checking that the field is still in view.
2. **A 320 px wide phone:** older and small Android phones must still not scroll sideways. The check runs one extra pass at 320×640 for the employee screens, reported but not blocking.
3. **Long names and IDs:** a 40-character full name, a shop name and a 64-character reset link must wrap rather than widen the page. The sample data includes these.
4. **Phone held sideways (landscape, 844×390):** the camera screens must keep their scan button reachable without scrolling past the video.
5. **The location sharing bar:** while the bar shows, it must never cover the action bar or form fields. Check both together on `/attendance`.

---

### Task 1: Integration merge

**Files:**
- Modify (resolve): `src/components/hr/EmployeeDirectory.jsx`, `src/styles/employee-directory.css`.
- Check: `src/App.jsx` and any file both sides changed.

- [ ] **Step 1:** `git merge --no-ff hr-gate-guard -m "Merge hr-gate-guard into integration"`. Expected: no conflict.
- [ ] **Step 2:** `git merge --no-ff origin/frontend/live-tracker-updates`. Expected: CONFLICT in exactly the two files above.
- [ ] **Step 3: Resolve both clashes, keeping both sides.**
  - **In `EmployeeDirectory.jsx`,** keep all of these imports: `AddEmployeeModal`, `LeaveModal`, `CATEGORIES`/`categoryForPosition` from the frontend constants, and `currentOrNextLeave`. Keep both sides' state, props and buttons.
  - **In the CSS,** keep both blocks.
  - **Then list the files both sides changed** (`git diff --name-only <merge-base>..outlet-visits` intersected with `<merge-base>..origin/frontend/live-tracker-updates`) and read each auto-merged result. **Expected:** `App.jsx` has the routes from both sides:
    - `ENROL_PATH`, `HR_SETUP_PATH`, `PASSWORD_RESET_PATH` and `VISIT_PATH`;
    - `LEGAL_VIEWS` and `LocationSharingBar`;
    - `VERIFY_PATH` and `DISPLAY_PATH`.
- [ ] **Step 4: Verify.** Run `npx vitest run`, `npx vite build` and `npx oxlint -D no-undef src`. Expected: all tests pass (both sides' suites), the build succeeds, and no new lint findings.
- [ ] **Step 5: Commit** the merge with a message listing what came from each side and how the two clashes were resolved.

### Task 2: The mobile check

**Files:**
- Create: `scripts/mobile-check.mjs`, `scripts/mobile-fixtures.mjs` (sample API answers).
- Modify: `package.json` (devDependency `@playwright/test`), `.gitignore` (`mobile-screenshots/`).

**Interfaces:**
- Produces: `node scripts/mobile-check.mjs [--only <name>] [--base <url>]`. Without `--base`, it starts `npx vite preview --port 4173` itself, after a `vite build`. Each screen is `{ name, path, setup?(page), states?: [{ name, act(page) }] }`, so later tasks can add states.

- [ ] **Step 1: Install the tool.** `npm i -D @playwright/test` and `npx playwright install chromium`. Expected: Chromium downloads.
- [ ] **Step 2: Write the fixtures.**
  - **Data answers:** the script answers `**/functions/v1/api/**` with fixed JSON for:
    - `/attendance/lookup/:id`;
    - `POST /attendance/events`, a check-in with a `trackingToken`;
    - `GET`/`POST /tracking/visits`;
    - `/public/enroll/:token`, `/public/hr-setup/:token` and `/public/password-reset/:token`, each valid or closed;
    - `/verify/:token`;
    - `/public/shops`;
    - `/hr/me`.
  - **Long values:** the samples include the long values from Review Focus 3.
  - **Supabase auth** (`**/auth/v1/**`) and REST (`**/rest/v1/**`) are answered so the HR portal reaches the "ready" state with sample rows for employees, shops, attendance events and settings. Read `src/services/backend/cache.js` and `permissionsService.sessionStatus()` for exactly which calls are needed.
  - **Browser stand-ins:** the camera is faked with a Chromium launch flag (`--use-fake-device-for-media-stream`), and geolocation is granted and set to Accra.
- [ ] **Step 3: Write the check.** Cover the screens and states in the spec's screen list. For each one:
  - open the screen and run its steps;
  - measure the three rules from Global Constraints in the page, ignoring hidden elements, and for tap size only links that are `display:inline` inside text;
  - save a screenshot;
  - print `pass|FAIL <size> <screen>/<state>` plus the reasons.

  Also add the Review Focus checks:
  - focus the last field of each form (1);
  - an extra pass at 320×640, reported as `warn` (2);
  - landscape 844×390 for the camera screens (4);
  - the location bar shown together with the action bar (5).
- [ ] **Step 4: Run it.** `node scripts/mobile-check.mjs`. Expected: **FAIL** lines, which are the baseline. Save the output to `mobile-screenshots/before.txt`, and copy the screenshots to `mobile-screenshots/before/`.
- [ ] **Step 5: Commit** with the message "Add an automatic mobile layout check". Commit the scripts, `package.json`, the lockfile and `.gitignore`, but no screenshots.

### Task 3: The shared mobile layer

**Files:**
- Create: `src/styles/mobile.css`.
- Modify: `src/main.jsx` (import it last among the global styles), `index.html` (add `viewport-fit=cover` to the viewport meta tag).

- [ ] **Step 1: Write `mobile.css`** with exactly the rules in spec Part 2, using the class names the screens really use. Before writing selectors, find the action bar, card, modal and table class names with a search across `src/styles` and `src/components`.
  - **Keyboard (Review Focus 1):** the sticky action bar becomes static, not sticky, while a field is focused: `@supports selector(:has(*))` plus `.registration-page:has(input:focus, select:focus, textarea:focus) .step-actions { position: static }`, with the same for the other page shells.
- [ ] **Step 2: Run** `node scripts/mobile-check.mjs`. Expected: fewer failures than `before.txt`, with no screen newly failing. Compare by screen.
- [ ] **Step 3: Run** `npx vitest run` and `npx vite build`. Expected: pass.
- [ ] **Step 4: Commit** with the message "Add a shared mobile layer".

### Task 4: Employee screens

**Files:** each screen's own stylesheet (`registration.css`, `display.css`, `location-sharing.css`, `legal.css`, `landing.css`, and so on), plus markup only where a layout can't be fixed in CSS.

- [ ] **Step 1: Fix each employee screen in turn,** in the order of the spec's list. For each one:
  - run `node scripts/mobile-check.mjs --only <screen>` and open its screenshots;
  - fix every failure and every clear visual problem (text against the edge, buttons side by side that should stack, a shrunken camera, cramped steps), using the existing tokens;
  - re-run until it passes at 360 and 390, and in landscape for the camera screens.
- [ ] **Step 2: Check the 320 px warnings.** For each one, fix it if it's a real overflow. A ruling is allowed only if the fix would change the look.
- [ ] **Step 3: Run** `npx vitest run` and `npx vite build`. Expected: pass.
- [ ] **Step 4: Commit,** one commit per screen group (home and registration; check-in, visit and the location bar; link pages; policy pages and the install card), each named after its screens.

### Task 5: HR portal, usable on a phone

**Files:** `hr.css`, the HR theme stylesheet from the frontend branch (`hr-soft3d.css`), `employee-directory.css`, `attendance.css`, `live-tracker.css`, `settings.css`, `notifications.css`, and the HR layout component (find which component renders the side menu).

- [ ] **Step 1: The menu.** Below 900 px, the side menu folds into a menu button that opens a drawer (`aria-expanded`, Escape closes it, focus stays inside). Skip this if the frontend branch already does it; record a ruling either way. Add the check state: open the drawer, and it passes the rules.
- [ ] **Step 2: Fix the remaining HR screens** in the list (sign-in, authenticator, dashboard, employees, attendance, live tracker, settings): wrap headers, scroll tables inside their box, stack filters, and make pop-ups fill the screen. Re-run the check until those screens pass.
- [ ] **Step 3: Run** `npx vitest run` and `npx vite build`. Expected: pass.
- [ ] **Step 4: Commit** with the message "Make the HR portal usable on a phone".

### Task 6: Report and wrap-up

**Files:**
- Modify: `README.md` (one line on `node scripts/mobile-check.mjs` under the checks).
- Create: the before-and-after report page, in the scratchpad, as an Artifact.

- [ ] **Step 1: Final run.** `node scripts/mobile-check.mjs`. Expected: every blocking line passes. Save the output to `mobile-screenshots/after.txt`.
- [ ] **Step 2: Final suite.** `npx vitest run`, `npx vite build` and `npx oxlint -D no-undef src`. Expected: pass, with no new findings.
- [ ] **Step 3: Backend unaffected.** Run `node scripts/smoke-live-tracker.mjs`. Expected: all pass.
- [ ] **Step 4: Commit** the README line.
- [ ] **Step 5: Build the report.** Make a page showing, for each employee screen at 390×844, the before and after screenshots side by side, plus the check's pass count before and after, then publish it. The screenshots are embedded as compressed images, keeping the page under 16 MB.
