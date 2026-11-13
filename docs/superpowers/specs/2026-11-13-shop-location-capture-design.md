# Capture shop locations at the shop, and check live tracking end to end

## Context

Visit proof depends on shop coordinates: a visit is "proven" only when the phone stays within 100 m of the shop for 10 minutes. Today HR can only set a shop's location from a desk (address lookup, map pin, typed coordinates), and the OpenStreetMap import gives approximate points. A wrong pin produces false "visit not proven" flags.

The user chose:
- **Shop location:** field staff capture it standing at the shop; HR approves before it counts.
- **GPS tracking:** live tracking is already built (clock-in to clock-out, foreground only) but has never been tried with a real phone. This plan verifies it end to end.

Later plans, in this order, each with its own design: (3) routes and history for HR, (4) tracking more people, (5) an Android app for tracking with the phone locked. None of them is in this plan.

## Approaches considered (shop location)

| Approach | Trade-off | Verdict |
|---|---|---|
| Capture at the shop, HR approves | Most accurate; one visit per shop | **Chosen by the user** |
| Learn the location from visit scans | No extra trips, but needs storing phone coordinates per visit, which the outlet-visits design forbids | Rejected |
| Better desk lookup (Google Places) | No travel; map data is patchy for small Ghana shops; paid key | Rejected |

## Design

### Who and when
- Supervisors, Sales Reps and Merchandisers (the roles with a tracking token), while clocked in, for shops **on their own list**.
- Auth is the existing tracking token, as for visits. No face scan (my call: the token already ties the request to the phone that clocked in, and HR approves every suggestion).
- A suggestion never changes the shop by itself. HR accepts or dismisses it.

### Phone
- New page `src/pages/SetShopLocation.jsx`, route `/shop-location`, lazy-loaded in `src/App.jsx` like `RecordVisit`. Same shell and classes as `src/pages/RecordVisit.jsx`.
- It lists the person's shops with one of: "No location yet", "Location set", "Your suggestion is waiting for HR".
- "Set location here" watches GPS for up to 20 seconds, shows the live accuracy ("Accuracy: 12 m"), and keeps the best fix. Save is enabled once accuracy is 30 m or better. Above that it says "Move outside or away from tall buildings and try again."
- Text on the page: "Stand at the shop entrance. This saves the shop's location for HR to confirm."
- Entry point: a "Set a shop's location" link in `src/components/tracking/LocationSharingBar.jsx` (shown to all three roles while a session is open), and a link on `RecordVisit.jsx` beside shops where `hasLocation` is false.
- New functions in `src/services/visitService.js`: `getShopLocations()` and `proposeShopLocation({ shopId, location })`. Generalise the private `call(method, body)` to take a path so all four functions share it.

### Rules (`supabase/functions/_shared/rules/tracking.js`)
- `MAX_CAPTURE_ACCURACY_M = 30`.
- `parseShopCapture(body)` returns `{ shopId, latitude, longitude, accuracy }` or `{ error }`. Reuses `parseVisitLocation` and requires a finite accuracy of 30 m or better. Errors: `Choose the shop.`, `Location is not available. Turn on Location (GPS).`, `The GPS reading is not accurate enough yet (±N m). Move into the open and try again.`
- `proposalRow({ session, shop, capture, now })` builds the row, including `distance_from_current_m` via `distanceMetres` when the shop already has coordinates.

### Database (one migration, `supabase/migrations/20261113090000_shop_location_proposals.sql`)
```sql
create table public.shop_location_proposals (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops (shop_id),
  company_id text not null references public.companies (id),
  staff_id text not null references public.employees (staff_id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m integer not null,
  distance_from_current_m integer,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  proposed_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz,
  unique (shop_id, staff_id)          -- a new capture replaces the person's earlier one
);
```
- RLS as in `20261112190000_outlet_visits.sql`: enabled and forced, service role all, `hr_read` select policy on `company_id`.
- `shops.location_source` check gains `'captured'`.
- `apply_change` is re-created with `shop_location_proposals` added to `writable` (copy the function from the outlet-visits migration).

### API
- `supabase/functions/api/trackingVisits.ts` (reuses `openSession`, `shopList`, rate limits):
  - `GET /tracking/shop-locations` returns `{ shops: [{ shopId, shopName, hasLocation, pending }] }`.
  - `POST /tracking/shop-locations` takes `{ shopId, location }`. Refuses a shop not on the person's list (400 `That shop is not on your list.`) and a bad reading (400 from `parseShopCapture`). Upserts on `(shop_id, staff_id)` through `applyChange`, resetting status to `pending`. Returns 201.
- `supabase/functions/api/hr.ts`:
  - Add `captured: 'captured at the shop and confirmed by HR'` to `LOCATION_SOURCES` (also in `src/services/shopsService.js`).
  - `PATCH /hr/shops/:shopId/location` accepts an optional `proposalId`. With it, the source must be `captured`, the coordinates come from the proposal row (not the body), the label is `Captured at the shop by <name> (±N m)`, and the same `applyChange` call marks that proposal `accepted` and the shop's other pending ones `dismissed`. The audit entry is unchanged in shape.
  - `POST /hr/shop-location-proposals/:id/dismiss` marks one `dismissed`, with an audit entry.

### HR portal
- `src/services/backend/cache.js`: add `shop_location_proposals` to `TABLES` and `LIVE_TABLES`.
- `src/services/shopsService.js`: `pendingLocationProposals(shopId)`, `acceptLocationProposal(shopId, proposalId)`, `dismissLocationProposal(id)`.
- `src/components/sales-monitoring/ShopsPanel.jsx`:
  - a shop card with pending suggestions shows a "Location suggested" badge (word plus shape, per `DIRECTION.md`);
  - `LocationModal` gains a "Suggested from the shop" section above the picker. Each row shows who, when, accuracy, and "N m from the current pin". Selecting one previews it on the existing `ShopMap`. Buttons: "Use this location" and "Dismiss".
  - HR cannot drag a captured pin and keep the `captured` label; moving it goes through the picker as `map-adjusted`, as today.

### Not in this plan
Notifications for new suggestions (the badge is enough for now), suggestions for shops off the person's list, new shops created from the phone, and any change to how tracking itself works.

## Tracking check

No new code unless a check fails; failures go through systematic debugging.

1. **Backend checks:** run `node scripts/smoke-live-tracker.mjs` (35 checks) and `node scripts/smoke-outlet-visits.mjs`. These need the Supabase CLI logged in; the token was invalid on 12 Nov, so the user runs `npx supabase login` first.
2. **Owed setup:** confirm whether `JOBS_SECRET` and the Vault `jobs_secret` are set (nightly summary). The user sets secrets in the dashboard; the agent does not.
3. **Real phone test.** A phone only gives its location over HTTPS, and the frontend is not hosted anywhere yet. The user has to choose how to get an address (host the site, or a temporary tunnel to the dev server) before this step. Then, with one test Sales Rep:
   - clock in on the phone; the green "Location sharing is on" bar appears;
   - HR's Live Field Tracker shows the person within a minute;
   - walk 100 m; the pin moves;
   - lock the phone for 5 minutes; record what happens (expected: points stop, this is plan 5's reason);
   - set a shop location at the shop, accept it in the HR portal;
   - stay 10 minutes, record a visit, clock out;
   - next day's report shows the visit as proven.
4. Write the result of each step into the final report, including anything that failed.

## Order of work

1. Branch `shop-location-capture` from `integration`. Commit this design as `docs/superpowers/specs/2026-11-13-shop-location-capture-design.md`.
2. Rules and unit tests first (`tests/shop-location.test.js`, vitest, in the style of `tests/outlet-visits.test.js`).
3. Migration, then API routes.
4. Phone page and service.
5. HR portal changes.
6. `scripts/smoke-shop-location.mjs` in the style of `scripts/smoke-outlet-visits.mjs`; add the new page and the modal state to `scripts/mobile-fixtures.mjs` / `scripts/mobile-check.mjs`.
7. Apply the migration (Management API) and deploy `api` (approved for this project) once the CLI is logged in.
8. Tracking check, steps 1 to 4 above.

## Verification

- `npm test` and `npm run lint`, plus `npx oxlint -D no-undef --env browser src`.
- Unit tests cover: accuracy 30 m accepted and 31 m refused; missing location refused; `distance_from_current_m` set only when the shop has coordinates.
- Live smoke covers: a shop off the list gives 400; a closed session gives 409; a second capture replaces the first; accepting sets `shops.latitude/longitude` with source `captured` and dismisses the other pending ones; an HR user of the other company reads no rows.
- `node scripts/mobile-check.mjs` still passes with the new page included.
- The real phone test above.

## Needed from the user

- `npx supabase login`, so the migration, deploy and smoke checks can run.
- A decision on how the phone reaches the app over HTTPS (hosting or a tunnel).
- A test Sales Rep account with a real enrolled face and one shop on its list.
