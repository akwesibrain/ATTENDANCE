# Shop Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Supervisor, Sales Rep and Merchandiser has a list of 1–7 shops from their company. The list is set at registration, edited by HR through `GET/PUT /hr/employees/:staffId/visit-list`, and every change is kept.

**Architecture:** Shared rules (`categories.js`, plus `parseShopList` in `registration.js`) decide who needs a list and validate it, the same way in the browser and on the server. Two new tables, `employee_shops` and `employee_shop_changes`, hold the list and its history. Company RLS lets the HR portal read them. Writes go only through `register_employee` and the whitelisted `apply_change`. `employees.assigned_shop_id` mirrors the first shop.

**Tech Stack:**
- Postgres (Supabase) with RLS;
- an Edge Function on Deno with Hono 4.6.14;
- vitest for unit tests;
- a Node smoke script for the live checks.

**Spec:** `docs/superpowers/specs/2026-11-12-shop-lists-design.md`

## Global Constraints

- **Shop limits:** at most 7 shops (`MAX_SHOPS = 7`), and positions run 1 to 7.
- **Who needs a list:** the field categories `supervisor`, `sales-rep` and `merchandiser`, from `categoryForPosition()`, which must match the frontend's mapping exactly.
- **Error messages, verbatim:**
  - `An allocated shop is required for this position. Select one, or add a new shop.`
  - `Choose at most 7 shops.`
  - `Choose shops from your company’s shop list.` (note the curly apostrophe)
  - `This employee’s position does not have a shop list.` (409)
- **Unchanged rule:** `requiresShop()` / `isFieldRole` stay as they are. SMS checks and the kiosk's site rule do not change.
- **Old request fields:** `shopMode`, `assignedShopId` and `newShop` keep working when `assignedShopIds` and `newShops` are both missing or empty.
- **Commands:**
  - Type check: `cd supabase/functions && npx -y deno check --node-modules-dir=none api/index.ts`, then `rm -f deno.lock`.
  - Migrations: `npx supabase db query --remote=aiiglvsvrbtahihttwge --yes -f <file>`.
  - Deploy: `npx supabase functions deploy api --project-ref aiiglvsvrbtahihttwge --yes`.
  - Unit tests: `npx vitest run`.
- **Live state:** `FACE_PROVIDER` is still `rekognition` live, so self-registration with a face returns 503. The live checks therefore add employees through HR without a face.
- **Audit:** `audit_events` is append-only, so the smoke run leaves audit rows behind.

## Review Focus

1. **Duplicate IDs in one request:** `assignedShopIds` containing the same ID twice should be stored once, never refused with a constraint error.
2. **A list naming another company's shop, or an inactive one:** the user should get the generic shop-list message, never a 500 and never a hint that the shop exists.
3. **Change-shop to a shop already lower on the list:** the shop should move to position 1 with no duplicate row, and the positions should stay 1..n with no gaps.
4. **PUT with the same list in a different order:** this is a change, because order sets the first shop. It writes a snapshot and updates `assigned_shop_id` when the first shop changes.
5. **An HR-added "Head of Supervisors" or "Supervisor Manager":** these must still be refused. Only the three exact field supervisor titles pass.

---

### Task 1: Shared rules

**Files:**
- Create: `supabase/functions/_shared/rules/categories.js`
- Modify: `supabase/functions/_shared/rules/registration.js` (`parseRegistration`, plus new `parseShopList` and `replaceFirstShop`)
- Test: `tests/shop-lists.test.js`

**Interfaces:**
- Produces:
  - `categoryForPosition(position: string): 'warehouse'|'sales-rep'|'merchandiser'|'supervisor'|'office'`
  - `TRACKED_CATEGORIES: string[]`
  - `needsShopList(position: string): boolean`
  - `MAX_SHOPS = 7`
  - `isFieldSupervisor(position: string): boolean`, true only for the exact titles `supervisor`, `field supervisor` and `sales supervisor`, ignoring case and spaces at either end.
  - `parseShopList(input: object): { shopIds: string[], newShops: object[] } | { error: string }`. It does not check company membership; the server does that.
  - `parseRegistration(body, { faceRequired = true, addedByHr = false })`. Its value has `shopIds: string[]` and `newShops: object[]` (both empty for non-field positions) in place of `shopId` and `newShop`.
  - `replaceFirstShop(list: string[], shopId: string): string[]`. It replaces `list[0]` with `shopId`, removes `shopId` from later positions, and keeps the other shops in order.
  - `sameShopList(a: string[], b: string[]): boolean`, comparing in order.

- [ ] **Step 1: Write the failing tests** in `tests/shop-lists.test.js`. Assertions:
  - `categoryForPosition`:
    - 'Merchandiser' and 'Merchandiser (Weekend)' → 'merchandiser';
    - 'Sales Representative' and 'sales rep' → 'sales-rep';
    - 'Supervisor', 'Field Supervisor' and 'Sales Supervisor' → 'supervisor';
    - 'Warehouse Assistant' → 'warehouse';
    - 'Cashier' and '' → 'office'.
  - `needsShopList`: true for 'Sales Representative' and 'Supervisor'; false for 'Cashier' and 'Warehouse Assistant'.
  - `parseShopList`:
    - `{assignedShopIds:['a']}` → `{shopIds:['a'], newShops:[]}`;
    - `['a','b','a']` → `['a','b']`;
    - 7 IDs pass;
    - 8 IDs → `{error:'Choose at most 7 shops.'}`;
    - 5 IDs plus 3 valid new shops → the same at-most-7 error;
    - `{}` → the allocated-shop-required error;
    - `{assignedShopIds:[], newShops:[{shopName:'X',town:'Accra',area:'Osu'}]}` → one new shop, with every field tidied;
    - a new shop with `shopName:'X'` (too short) → `{error:'Enter the shop name (e.g. China Mall).'}`;
    - legacy `{shopMode:'existing', assignedShopId:'a'}` → `['a']`;
    - legacy `{shopMode:'new', newShop:{…valid…}}` → one new shop;
    - non-string IDs are ignored.
  - `parseRegistration` (use the valid body from `tests/onboarding.test.js`):
    - with `position:'Sales Representative'` and no shops → `errors.shop` is set;
    - with `assignedShopIds:['a','b']` → `value.shopIds` is `['a','b']`;
    - with `position:'Supervisor'` → `errors.position` is set; with `{addedByHr:true}` and `assignedShopIds:['a']`, there is no `errors.position` and `value.shopIds` is `['a']`;
    - with `position:'Supervisor Manager'` and `{addedByHr:true}` → `errors.position` is still set;
    - with `position:'Cashier'` → `value.shopIds` is `[]`.
  - `replaceFirstShop` replaces the old first shop:
    - `(['a','b','c'],'c')` → `['c','b']`;
    - `(['a','b'],'z')` → `['z','b']`;
    - `([],'z')` → `['z']`.
  - `sameShopList(['a','b'],['b','a'])` → false.
- [ ] **Step 2: Run** `npx vitest run tests/shop-lists.test.js`. Expected: FAIL, because `categories.js` does not exist.
- [ ] **Step 3: Implement.**
  - Copy the `categoryForPosition` body from `origin/frontend/live-tracker-updates:src/constants/employeeCategories.js` into `categories.js`.
  - `parseShopList` takes at most `MAX_SHOPS + 1` IDs before counting, so it never loops over a huge array. It builds on `validateNewShop` and the `clean`/`text` helpers already in `registration.js`.
  - In `parseRegistration`, replace the `requiresShop` block with `needsShopList` plus `parseShopList`. The elevated-title check is skipped when `addedByHr && isFieldSupervisor(position)`, so `validateJobPosition` gets an `{ allowFieldSupervisor }` option.
  - Leave `requiresShop` and `FIELD_POSITIONS` exactly as they are.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all pass, including the existing `onboarding` and `employee-rules` suites.
- [ ] **Step 5: Commit** with the message "Add shared rules for 1–7 shop lists".

### Task 2: Database

**Files:**
- Create: `supabase/migrations/20261112160000_employee_shop_lists.sql`

**Interfaces:**
- Consumes: none.
- Produces:
  - Tables `employee_shops` and `employee_shop_changes`, with the exact columns in the spec.
  - `apply_change` can write both tables, and can delete from `employee_shops`.
  - `register_employee(p_employee jsonb, p_template jsonb, p_shop_ids text[] default null, p_new_shops jsonb default null, p_added_by jsonb default null) returns jsonb`.

- [ ] **Step 1: Write the migration.**
  - **Tables and grants:** the two tables and indexes, word for word from the spec. Enable and force RLS, revoke from `public`/`anon`/`authenticated`, grant all to `service_role`. Add a select policy for `authenticated`: `company_id = any ((select app_private.hr_company_ids())::text[])`. Copy the pattern from `20261111090000_workplace_displays.sql:48`.
  - **Backfill:** `insert into employee_shops (staff_id, shop_id, company_id, position, assigned_by) select staff_id, assigned_shop_id, company_id, 1, 'Backfill' from employees where assigned_shop_id is not null on conflict do nothing`.
  - **`apply_change`:** `create or replace` it, copying the whole body from `20261112090000_hr_onboarding.sql` (the latest definition). Add `'employee_shops', 'employee_shop_changes'` to `writable` and `'employee_shops'` to `deletable`.
  - **`register_employee`:**
    - `drop function public.register_employee(jsonb, jsonb, text, jsonb, jsonb)`, after checking the exact signature in `hr_onboarding.sql:57`.
    - Recreate it from that body, with a loop over `p_new_shops` (each element is in today's `p_new_shop` shape and creates or reuses a shop the same way). Then add `p_shop_ids`.
    - Build `v_ids text[]` from the picked shops (de-duplicated, in order), then the new shops.
    - Raise `P0001 'Choose shops from your company’s shop list.'` if any picked ID is not an active shop of `v_company_id`.
    - Raise `P0001 'Choose at most 7 shops.'` if `cardinality(v_ids) > 7`.
    - Set `assigned_shop_id = v_ids[1]`. Insert `employee_shops` rows with `position = ordinality` and `assigned_by = v_actor_name`. Keep the `shop_assignments` insert for `v_ids[1]`. When `v_ids` is not empty, insert one `employee_shop_changes` row (`previous '{}'`, `next v_ids`, `by_name v_actor_name`, `by_role v_actor_role`).
    - Re-apply the same revoke and grant to the function as the end of `hr_onboarding.sql`.
- [ ] **Step 2: Apply it live** with the migrations command. Expected: no error.
- [ ] **Step 3: Verify live with SQL:**
  - `select count(*) from employee_shops` equals `select count(*) from employees where assigned_shop_id is not null`;
  - `select pg_get_function_identity_arguments('public.register_employee'::regproc)` lists `p_shop_ids text[], p_new_shops jsonb`;
  - `select public.apply_change('[{"table":"employee_shops","op":"delete","match":{"staff_id":"NOPE-0000"}}]'::jsonb)` succeeds and deletes nothing.
- [ ] **Step 4: Commit** with the message "Add employee shop lists to the database".

> Between Task 2 and Task 3, the live function still sends `p_shop_id` and `p_new_shop`, so registration fails live until Task 3 deploys. Do Task 3 straight away.

### Task 3: Registration sends the list

**Files:**
- Modify:
  - `supabase/functions/api/enrolment.ts` (`registerEmployee`);
  - `supabase/functions/api/employeeOnboarding.ts` (the `POST /employees` parse call);
  - `supabase/functions/api/public.ts` (the register response).
- Create: `scripts/smoke-shop-lists.mjs`, the registration part.

**Interfaces:**
- Consumes: from Task 1, `parseRegistration(body, { faceRequired, addedByHr })` with `value.shopIds` and `value.newShops`. From Task 2, `register_employee(..., p_shop_ids, p_new_shops, p_added_by)`.
- Produces: the register and HR-add responses include `assignedShopIds: string[]`, read back from `employee_shops` ordered by position.

- [ ] **Step 1: Write the smoke script's registration checks.** Copy the env, sql, call, totp, signIn, signInWithMfa and makeHr helpers from `scripts/smoke-hr-passwords.mjs`, with the email prefix `smoke-shops-`. `makeHr(label, companyIds)` takes the HR user's companies. Read two active shops of `box-for-less` and one of `double-a` with SQL. Checks, all through `POST /hr/employees` without a face, with `position: 'Sales Representative'` and names that start with "Smoke Test":
  - no shops → 400 with `errors.shop`;
  - 8 IDs → 400 `Choose at most 7 shops.`;
  - one `double-a` shop for a `box-for-less` employee → 400 `Choose shops from your company’s shop list.`;
  - 2 picked shops plus 1 new shop → 201, `assignedShopIds` has length 3 with the picked shops first, and SQL shows `assigned_shop_id` = the first and one `employee_shop_changes` row;
  - legacy `{shopMode:'existing', assignedShopId}` → 201 with one shop;
  - `position:'Supervisor'` from HR with one shop → 201.

  Record every created staff ID for clean-up. Clean-up deactivates each one through `POST /hr/employees/:id/status`, reading the body shape from `hr.ts:149`, and deletes the HR users the way the passwords smoke does.
- [ ] **Step 2: Run** `node scripts/smoke-shop-lists.mjs`. Expected: FAIL. The live function still sends the old parameters, so registration returns 500 or 400.
- [ ] **Step 3: Implement.**
  - **`registerEmployee`:** send `p_shop_ids: form.shopIds` and `p_new_shops: form.newShops.map(…)`. Each new shop keeps today's shape, including a `shop_id` built from the slug plus a random suffix. Remove `p_shop_id` and `p_new_shop`.
  - **Error mapping:** map the two new `P0001` messages to `invalid({ shop: message })`. Check how `rpc` errors reach the person today in `lib.ts`, and follow that.
  - **`employeeOnboarding.ts`:** pass `addedByHr: true`.
  - **Both responses:** add `assignedShopIds`.
  - Type check, then deploy.
- [ ] **Step 4: Run** the smoke script and `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Register field employees with 1–7 shops".

### Task 4: HR edits the list

**Files:**
- Create: `supabase/functions/api/hrShopLists.ts`, mounted in `hr.ts` with `hrRoutes.route('/', hrShopListRoutes)`, the same way `hrPasswordRoutes` is.
- Modify: `supabase/functions/api/hr.ts`, the `POST /employees/:staffId/shop` route.
- Modify: `scripts/smoke-shop-lists.mjs`, to add the list checks.

**Interfaces:**
- Consumes: from Task 1, `needsShopList`, `parseShopList`, `replaceFirstShop`, `sameShopList` and `MAX_SHOPS`. From Task 2, the tables and `apply_change`.
- Produces:
  - `GET` and `PUT /hr/employees/:staffId/visit-list`, with the response `{ shopIds, updatedAt, updatedBy, history: [{ at, by, previous, next }] }`. History is newest first, at most 50 entries.
  - `shopListOps(emp, hr, next: string[], previous: string[]): object[]`, exported from `hrShopLists.ts` and used by both routes. It returns the `apply_change` ops:
    - delete `employee_shops` matching `{staff_id}`;
    - insert one row for each shop;
    - insert the snapshot;
    - when the first shop changes, deactivate the old `shop_assignments` row, insert the new one and update `employees.assigned_shop_id`. This is the same op sequence as the existing route at `hr.ts:205-221`.

- [ ] **Step 1: Add the smoke checks.** The Box-for-Less-only HR user (`makeHr('bfl', ['box-for-less'])`) works on the employee with 3 shops from Task 3:
  - GET → 200 with 3 shopIds and a history of 1;
  - PUT with a `double-a` shop → 400;
  - PUT with 8 → 400;
  - PUT `[s2, s1]` → 200 with `shopIds` `[s2, s1]`, history of 2, `assigned_shop_id` = s2 in SQL, and one new audit row `Employee shop list changed` since the start;
  - PUT `[s2, s1]` again → `{unchanged: true}` with no new snapshot;
  - GET for a Cashier employee (add one) → 409 with the no-shop-list message;
  - `POST /hr/employees/:id/shop` with `{shopId: s1}` → the list becomes `[s1]`, because s1 moves up and replaces s2. Then SQL `select position from employee_shops where staff_id=…` returns 1 only.
  - **RLS:** the `bfl` HR user's token reading `/rest/v1/employee_shops?company_id=eq.double-a` returns `[]`, while `company_id=eq.box-for-less` returns rows.
- [ ] **Step 2: Run** the smoke script. Expected: the new checks FAIL with 404, because the route does not exist.
- [ ] **Step 3: Implement.**
  - **Both routes:** load the employee with an `employeeFor`-style lookup (normalise, 404, `assertCompany`). Refuse a non-field position with 409.
  - **PUT:** `parseShopList({ assignedShopIds: body.shopIds })`, where a `newShops` field is ignored and refused. Then check the IDs against `shops` where `company_id = emp.company_id` and `status = 'active'`. If they are unchanged under `sameShopList`, return `{unchanged: true}`. Otherwise apply `shopListOps` with the audit row; its previous and next values are lists of shop names.
  - **Change-shop route:** read the current list, build `next = replaceFirstShop(current, shop.shop_id)`, and replace its op list with `shopListOps`. Keep its current error messages and audit wording.
  - Type check, then deploy.
- [ ] **Step 4: Run** the smoke script and `npx vitest run`. Expected: all pass.
- [ ] **Step 5: Commit** with the message "Let HR edit an employee's shop list".

### Task 5: HR portal reads, and docs

**Files:**
- Modify:
  - `src/services/backend/cache.js`: add `employee_shops: { order: 'position' }` and `employee_shop_changes: { order: 'at' }` to `TABLES`;
  - `README.md`: one line in the API/feature table, and `node scripts/smoke-shop-lists.mjs` under live checks.

- [ ] **Step 1:** Make the edits. Run `npx vitest run` and `npx oxlint -D no-undef src`. Expected: tests pass, with no new lint findings beyond the known browser-global false positives.
- [ ] **Step 2:** Run `node scripts/smoke-shop-lists.mjs` once more from clean. Expected: every check passes.
- [ ] **Step 3: Commit** with the message "Load shop lists in the HR portal and document them".
