# Multiple Shops per Employee, Distance Instead of a Radius, and the Shop Import — Backend Specification

**Project:** Workforce Pro — Attendance & HR (Box For Less, Double A)
**Version:** 1.1 · 11 November 2026 (1 to 7 shops; distance only, HR decides)
**For:** the backend developer
**Status:** the frontend is done (registration form, monitoring pages,
policies); the backend changes below are still needed.

Company decisions (11 November 2026):

1. **Every field employee the tracker covers** — Supervisors, Sales
   Representatives and Merchandisers — works at **1 to 7 shops** (one shop,
   plus up to six more).
2. **The 150 m radius is removed — distance only, HR decides.** No pass/fail
   on distance anywhere. HR sees **how far** the employee was from the shop
   ("40 m", "2.3 km") on SMS checks, visits and the tracker, and judges. A
   shop visit is **proven** when live tracking shows a stay of **10+ minutes
   within 100 m** of the shop (100 m = a fixed allowance for GPS error only).
3. **300 real places** (100 shops, 100 supermarkets, 100 malls in Ghana) are
   added to the shop list **for both companies**, with coordinates from
   OpenStreetMap.

---

## 1. One to seven shops per field employee

### What the frontend sends

`POST /employees/register` (Sales Representatives and Merchandisers — the
backend does not allow self-registering as a Supervisor):

```json
{
  "shopMode": "existing",
  "assignedShopId": "shop-bfl-001",
  "newShop": { "shopName": "", "town": "", "area": "", "address": "" },
  "assignedShopIds": ["shop-bfl-001", "shop-bfl-osm-n123"],
  "newShops": [{ "shopName": "Super Save", "town": "Accra", "area": "Osu", "address": "" }],
  "...": "unchanged"
}
```

- The employee ticks shops from the list (`assignedShopIds`) and/or adds shops
  that are not in it (`newShops`, each validated like `newShop`). Total:
  **1 to 7**.
- The fields the backend reads today still point at the **first** shop, so
  registration keeps working: if any shop is ticked → `shopMode: "existing"`,
  `assignedShopId` = first ticked; otherwise → `shopMode: "new"`,
  `newShop` = first new shop. `assignedShopIds` and `newShops` are ignored
  today.

### Backend changes

- Table `employee_shops (staff_id, shop_id, assigned_at, assigned_by,
  primary key (staff_id, shop_id))`, with history like `shop_assignments`.
  Keep `employees.assigned_shop_id` as the first shop until all screens read
  the new table.
- `parseRegistration`: accept `assignedShopIds` (known shops of the employee's
  company, de-duplicated) and `newShops` (create each, like `newShop`); for
  field positions require **1 to 7** shops in total. Insert all links in
  `register_employee`.
- HR: assign/unassign shops for Supervisors, Sales Reps and Merchandisers
  (Employees → Assign shops), 1 to 7, every change in the audit log.
- The **daily shop list** for Sales Reps / Supervisors
  (`GET/PUT /employees/:staffId/visit-list`, see
  `docs/backend-live-tracker-and-sms-verification.md` §3.6) can simply be the
  employee's assigned shops. The frontend keeps a browser-only copy until then
  (`src/services/visitListService.js`).
- Return `assignedShopIds` in `listEmployees()` rows.

---

## 2. Distance instead of a radius ("distance only, HR decides")

No pass/fail on distance anywhere; record and return **distances** instead.

| Where | Change |
|---|---|
| `shops.geofence_radius` | Drop the column (or stop using it). |
| Settings → monitoring `defaultGeofenceRadius` | Remove the setting. |
| SMS verification | **Verified** when the face (and liveness) pass. Keep `distanceFromShop` (metres to the employee's **nearest assigned shop**) and `gpsAccuracy` for HR to read; no `outside-shop` result. `gps-unavailable` stays as information only (not a failure). The frontend shows "40 m from the shop". |
| Alerts | Remove "Outside assigned shop radius". "GPS unavailable" becomes low/informational. Keep missed / failed face / SMS delivery failure / repeated failures / not checked in / incomplete. |
| Outlet visits | Store the visit with the phone location and `verification: { status: "recorded" | "location-unavailable", distance }` — `distance` in metres to the visited shop, no inside/outside. |
| Shop visit proof | **Proven** when live tracking shows a stay of **≥ 10 minutes** with every point **within 100 m** of the shop (100 m = GPS-error allowance) and no gap over 5 minutes. A recorded visit without such a stay → `no-stay` (flag). Nothing by the end of the day → `missed`. Shop without coordinates → `unmeasured`. Reference: `shopStays()` / `visitProof()` in `src/services/visitListService.js`. |
| Daily tracking summaries | Keep per-shop `shopStays: { shopId: { minutes, longestMinutes, closest } }` (closest = metres; still no positions). |
| Live map | Return each person's assigned shops so HR sees "Nearest shop — 2.3 km away" (the frontend computes it from the live position). |
| Location mismatch alert (SMS vs live tracking) | Optional: show both distances to HR instead of an automatic alert. |

Frontend screens still showing backend geofence results (merchandiser SMS
detail in `AttendanceDetailModal`, `NotificationDrawer`, the monitoring
settings section) will follow automatically once the backend stops sending
distance results; tell the frontend if any field is removed so the labels can
be tidied.

---

## 3. Import the 300 places

The frontend repo has a script that builds the import from OpenStreetMap
(real places, real coordinates):

```bash
node scripts/build-osm-shop-import.mjs
```

It writes:

- `docs/data/osm-places.csv` — the list for HR to review first;
- `docs/data/osm-shops-import.sql` — `insert into public.shops …` with each
  place **twice** (one row per company, ids `shop-bfl-osm-<id>` and
  `shop-daa-osm-<id>`), `location_source = 'geocoded'`, label
  `OpenStreetMap <id> (Shop|Supermarket|Mall)`, `on conflict do nothing`.

Notes:

- The public OpenStreetMap service was at capacity when this was prepared, so
  the files have **not** been generated yet. The script waits and retries,
  then stops; run it again later.
- OpenStreetMap may have fewer than 100 malls in Ghana; the script reports how
  many it found of each type.
- Keep the attribution "© OpenStreetMap contributors" (ODbL) wherever the data
  is shown or exported.
- If `geofence_radius` is still `not null`, its default (150) is used — it is
  unused after §2.

---

## 4. Acceptance checks

- Registering a Sales Rep with 0 shops is rejected; 1 to 7 creates one link
  per shop (including new shops); 8 is rejected. `assignedShopId` equals the
  first ticked shop.
- A Supervisor created by HR can be given 1 to 7 shops.
- An SMS check where the face passes is `verified` wherever the phone is, and
  carries its distance from the nearest assigned shop.
- No API response contains a geofence radius or an inside/outside result.
- Points every 3 minutes within 100 m of a listed shop from 09:00 to 09:12
  → stay 12 minutes → `proven`. A visit at 09:00 with the person 2 km away
  afterwards → `no-stay`.
- After importing, each place exists once per company with coordinates, and
  shows in the registration shop list for both companies.
