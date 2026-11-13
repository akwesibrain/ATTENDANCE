# Shop lists (1 to 7 shops per field employee) — design

**Date:** 12 November 2026
**Branch:** `shop-lists`, built on `hr-passwords`
**Project 1 of 3.** The Live Tracker (project 2) measures shop stays against these lists, and outlet visits (project 3) flag visits to shops that are not on them.

Sources: `docs/backend-multi-shop-and-places.md` §1 and §4, and
`docs/backend-live-tracker-and-sms-verification.md` §3.6, both on
`origin/frontend/live-tracker-updates`.

## Goal

Every Supervisor, Sales Representative and Merchandiser has a list of **1 to 7 shops** from their own company. The list is set at registration and changed by HR, and every change is kept. It is also their **daily visit list**: there is one list, not two.

## Decisions

| # | Decision |
|---|---|
| 1 | One list per employee. The shops picked at registration, or later assigned by HR, are the daily visit list. |
| 2 | New tables `employee_shops` (the current list) and `employee_shop_changes` (a snapshot of each change). `shop_assignments` is left as it is. |
| 3 | `employees.assigned_shop_id` always equals the first shop on the list, so SMS checks and existing screens keep working without changes. |
| 4 | Field roles come from `categoryForPosition()`, moved into the shared rules: `supervisor`, `sales-rep` and `merchandiser` need 1 to 7 shops. |
| 5 | SMS checks keep their current rule (`isFieldRole`: Sales Representatives and Merchandisers, checked at the first shop). Removing the radius is multi-shop §2, which is out of scope. |
| 6 | HR may add an employee with a field supervisor position (`Supervisor`, `Field Supervisor`, `Sales Supervisor`). Self-registration still refuses them, along with every other elevated title. HR still cannot add admin, HR, manager or director titles. |
| 7 | The old single-shop request fields keep working, so the frontend on `main` keeps working. |

Out of scope: removing the radius (multi-shop §2), the OpenStreetMap import (§3), showing the list on the phone (project 3), and frontend changes (the frontend developer switches `visitListService` to these endpoints).

## Shared rules

`supabase/functions/_shared/rules/categories.js` (new):

- `categoryForPosition(position)`: the same mapping as the frontend's `src/constants/employeeCategories.js`: `merchandiser…` → `merchandiser`; `sales representative` / `sales rep` → `sales-rep`; `supervisor` / `field supervisor` / `sales supervisor` → `supervisor`; anything containing `warehouse` → `warehouse`; everything else → `office`.
- `TRACKED_CATEGORIES = ['supervisor', 'sales-rep', 'merchandiser']`.
- `needsShopList(position)`: whether the position's category is in `TRACKED_CATEGORIES`.
- `MAX_SHOPS = 7`.

`registration.js`:

- `parseShopList(input, { companyShops })` returns `{ shopIds, newShops }` or a `shop` error. It reads:
  - `assignedShopIds`: trimmed and de-duplicated, in the order given;
  - `newShops`: each one tidied and checked with `validateNewShop`.
- **Legacy fallback:** when both lists are missing or empty, it falls back to `shopMode` / `assignedShopId` / `newShop`.
- **Errors:**
  - `An allocated shop is required for this position. Select one, or add a new shop.` when the list is empty;
  - `Choose at most 7 shops.` when there are more than 7;
  - `Choose shops from your company’s shop list.` when a shop ID is not one of the company's **active** shops. The server checks this against the database.
  - The first error of a new shop, when one is invalid.
- `parseRegistration` uses `needsShopList(position)` instead of `requiresShop`. Its value carries `shopIds` and `newShops`, which replace `shopId` and `newShop`.
- A new option, `parseRegistration(body, { faceRequired, addedByHr })`. With `addedByHr: true`, a field supervisor position passes the elevated-title check (decision 6).

## Database (one migration)

```sql
create table public.employee_shops (
  staff_id    text not null references public.employees (staff_id),
  shop_id     text not null references public.shops (shop_id),
  company_id  text not null references public.companies (id),
  position    smallint not null check (position between 1 and 7),
  assigned_at timestamptz not null default now(),
  assigned_by text,
  primary key (staff_id, shop_id),
  unique (staff_id, position)
);
create index employee_shops_company_idx on public.employee_shops (company_id);

create table public.employee_shop_changes (
  id          uuid primary key default gen_random_uuid(),
  staff_id    text not null references public.employees (staff_id),
  company_id  text not null references public.companies (id),
  at          timestamptz not null default now(),
  by_name     text not null,
  by_role     text,
  previous    text[] not null,
  next        text[] not null
);
create index employee_shop_changes_staff_idx on public.employee_shop_changes (staff_id, at desc);
```

- **RLS:** both tables get the same read policy as the other company tables, `company_id = any (app_private.hr_company_ids())`. No one writes directly: changes go through `apply_change`, which whitelists both tables, and `register_employee`.
- **Backfill:** one `employee_shops` row (position 1, `assigned_by = 'Backfill'`) for each employee with an `assigned_shop_id`. There are no snapshot rows for the backfill.
- **`register_employee`** gains `p_shop_ids text[] default null` and `p_new_shops jsonb default null` (an array). It:
  - creates each new shop, the same way as today's `p_new_shop`;
  - checks that every shop belongs to the employee's company;
  - inserts the `employee_shops` rows (picked shops first, in the order given, then new shops);
  - sets `assigned_shop_id` to position 1 and keeps the existing `shop_assignments` insert for that shop;
  - writes one `employee_shop_changes` row (`previous = '{}'`).

  The old `p_shop_id` / `p_new_shop` parameters are dropped. The function is replaced, and the Edge Function is its only caller.
- Refusals keep error code `P0001`, with the messages above, so they reach the person as a 400.

## API

`GET /hr/employees/:staffId/visit-list`:

```json
{ "shopIds": ["shop-bfl-001", "shop-bfl-007"],
  "updatedAt": "2026-11-12T09:00:00Z", "updatedBy": "HR Manager",
  "history": [{ "at": "…", "by": "HR Manager", "previous": ["shop-bfl-001"], "next": ["shop-bfl-001", "shop-bfl-007"] }] }
```

`PUT /hr/employees/:staffId/visit-list` with body `{ "shopIds": [...] }`:

- The employee must be in one of the HR user's companies and have a field position. Otherwise: `409 This employee’s position does not have a shop list.`
- The list must hold 1 to 7 de-duplicated **active** shops of the employee's company. Errors return 400 with the messages above.
- If the list is unchanged, it returns 200 `{ "unchanged": true }` and writes nothing.
- Otherwise, in one `apply_change` call:
  - delete and re-insert the `employee_shops` rows;
  - insert an `employee_shop_changes` row;
  - when the first shop changes, update `employees.assigned_shop_id` and add a `shop_assignments` row the way the existing route does;
  - write an audit row: source `Employees`, action `Employee shop list changed`, category `Shifts & Shops`. Its previous and next values list the shop names.
- The response is the same shape as the GET.

The existing `POST /hr/employees/:staffId/shop` (change shop) now **replaces only the first shop**. The rest of the list is kept, and the new shop is removed from later positions if it was already there. It writes a snapshot as well.

The HR portal's cache loads `employee_shops` and `employee_shop_changes` like the other tables. The frontend then builds `assignedShopIds` from those rows.

## Error handling

- Another company's shop, an inactive shop or an unknown shop all give the same message, so shop IDs from other companies are never revealed.
- Two HR users saving at the same time: the last save wins, and both saves are kept in the history. The delete and re-insert happens in a single transaction inside `apply_change`, so a list is never half-written.

## Testing

**Unit tests** (`tests/shop-lists.test.js`):

- `categoryForPosition` matches the frontend's mapping for every example title.
- `parseShopList` accepts 1 and 7 shops, refuses 0 and 8, de-duplicates, mixes picked and new shops, uses the legacy fallback, and reports a bad new shop.
- `parseRegistration` lets HR add a `Supervisor` and refuses one at self-registration.

**Live smoke** (`scripts/smoke-shop-lists.mjs`):

- Self-registering a Sales Rep with 0 shops is refused, with 8 shops is refused, and with 2 picked shops and 1 new shop gives 3 rows, with `assigned_shop_id` = the first shop.
- An old-style request with `assignedShopId` only still registers.
- HR `PUT` with a shop from the other company gives 400. A valid change writes the snapshot and the audit row. Changing the first shop updates `assigned_shop_id`.
- HR from Box For Less cannot read Double A's `employee_shops` rows.
- Clean-up: the test employees are deactivated. Audit rows stay, because that table is append-only.
