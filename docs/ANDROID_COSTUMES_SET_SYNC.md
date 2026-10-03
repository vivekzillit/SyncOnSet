# Zillit Android — Costumes & Set Sync module

**For:** the Zillit Android app team
**What:** add the Costumes & Set Sync tool to the Zillit Android app, as was done for iOS
**API:** Costumes & Set Sync service (`zillit_sync_on_set`)
**Reference implementations:**
- **iOS (Swift, done):** repo `Zillit-IOS`, branch `costume-set-sync`, folder `Zillit/Zillit/Controller/CostumesAndSetSync/`
- **Web (the UI spec):** repo `SyncOnSet` (`main`), `frontend/src/`, live at https://costumes-and-set.onrender.com

**Status:** to implement

### Changes on 2026-10-03

Applied to iOS today; build Android the same way.

| Area | Change | Section |
| --- | --- | --- |
| Top bar | A **back chevron** at the top left, as in the other Zillit modules; it leaves the tool from any page | 6.3 |
| Top bar | **Scan** and the **settings gear** are hidden for now; the bar shows back, brand, production, Search and the bell | 6.3 |
| Documents (new API) | **View script** / **View schedule** under the upload buttons on Scene Breakdown, **View callsheet** under Upload callsheet on On set, and the document viewer with Import / Apply | 2.9 (21), 6.4 |
| Documents | `file_token` from the parse sent back on import / apply, so uploaded files join the list; the call sheet header shows the newest call sheet (`callsheet_source`, `callsheet_document`) | 2.9 (21), 6.4 |
| Bug fix | `POST /schedule/parse` must always get the form field `kind`; without it a call sheet's `document_id` fails with "Document does not exist" | 2.9 (21) |
| Bug fix | Scene Breakdown showed only its header after a successful import: don't put the table rows in a separately measured, height-capped scroll | 6.4 |

---

## 1. What to build

A new tool, **Costumes & Set Sync**, on the Zillit **Tools** page. Opening it shows the costume department's workspace for the current Zillit project:

- scene breakdown, characters and actors, costume changes (looks);
- the costume inventory with QR labels and scanning;
- fittings, cleaning ("Sink"), alterations, damage and missing items;
- on-set continuity, take by take, and the continuity book;
- vendors and rentals, budget, reports, gallery, notifications, team roles and project settings.

The backend is live; the app only adds screens. The tool must **look and behave like the web app's current layout** (section 6). When the web and the old SyncOnSet behaviour differ, follow the web on `main`.

---

## 2. Backend contract

### 2.1 Hosts

| Environment | Base URL |
| --- | --- |
| DEV | `https://synconsetapi-dev.zillit.com/api/v2` |
| QA | `https://synconsetapi-qa.zillit.com/api/v2` |
| Prod | `https://synconsetapi.zillit.com/api/v2` |

Every tool route is under `/projects/{projectId}/…`. The two service routes, `GET /health` and `GET /meta`, need no project.

### 2.2 Authentication

- Send the **Zillit project token** as `Authorization: Bearer <token>`. This is the same token every other Zillit API uses. The `{projectId}` in the URL must be the project that token belongs to.
- DEV tokens expire after **5 minutes**. On `401`, refresh the project token with the app's normal token refresh, retry the request **once**, then fail.
- Multipart uploads need the same credentials as JSON calls. On iOS, an upload that bypassed the shared request builder went out with no credential and got `406 libs_module_data_invalid`.

### 2.3 Response format

```json
{ "status": 1, "message": "costume_set_sync_costume_created", "messageElements": [], "data": { … } }
```

- `status` is `1` for success and `0` for failure.
- `message` is a message key. Translations are at `https://synconsetapi<env>.zillit.com/<lang>/messages.json`. Fall back to a readable form of the key, e.g. `costume_set_sync_costume_created` → "Costume created".
- Field names are **snake_case**. Record ids are `_id`. Dates are **epoch milliseconds**, and `0` means "not set". Inputs also accept ISO-8601 strings.
- Some endpoints return raw files instead of JSON: `costumes/{id}/qr.png`, `qr.svg`, `reports/daily.csv`, `expenses/import/template` (xlsx).

### 2.4 Status codes

| Code | Meaning | What the app does |
| --- | --- | --- |
| 200 | Success | |
| 401 | Token expired or invalid | Refresh the token, retry once |
| 403 | No access: `costume_set_sync_access_denied`, `costume_set_sync_role_forbidden`, `costume_set_sync_tool_not_enabled`, `costume_set_sync_project_mismatch` | **Show it on the screen** (see below). Do **not** run the app's global 403 handling. |
| 406 | Validation error; the message key names the field | Show the message |
| 400 / 404 | Business rule / not found | Show the message |

> **Important:** iOS's shared network layer treats every 403 as a session problem and sends the user to All Projects. This service uses 403 for normal situations, such as the tool not being switched on yet or a role not being allowed an action. If the Android network layer does the same, give this module its own error handling. Keep reusing the shared credential headers and token refresh.

When `costume_set_sync_tool_not_enabled` is returned, show: "Costumes & Set Sync is switched off. Ask the project admin to switch the tool on from the project's tools settings."

### 2.5 Rights

There are two layers:

1. **Zillit tool rights** for `costume_set_sync_tool`:
   - Without **view** access, hide the tile and leave the tool if access is revoked mid-session.
   - Without **posting** access, hide every add, edit and delete control.
2. **In-tool role**, `my_role` from `GET /projects/{projectId}`:
   - Project admins get `ADMIN`; tool viewers without posting rights get `VIEWER`.
   - `GET /meta` returns the role groups the screens check:

| Group (`/meta`) | Roles | Unlocks |
| --- | --- | --- |
| `finance_roles` | ADMIN, PRODUCTION_MANAGER, COSTUME_DESIGNER, COSTUME_SUPERVISOR | Budget tab; costs on costumes, damage and rentals; spend in reports |
| `manager_roles` | same four | Team & roles, Project settings |
| `ops_roles` | managers + COSTUME_ASSISTANT, WARDROBE_ASSISTANT, DRESSER | Costume movements (issue, return, to set …) |
| `VIEWER` | — | Read only |

### 2.6 Endpoints

The full list is the Postman collection **"Costumes & Set Sync — DEV"**: 135 requests in 22 folders, each with the real DEV curl and response (`Costumes_and_Set_Sync_DEV.postman_collection.json`, from Shubham's 2026-09-29 mail). The paths are SyncOnSet's, unchanged, under `/api/v2`. Summary:

| Area | Routes (all under `/projects/{projectId}`) |
| --- | --- |
| Project | `GET /` (settings, counts, `my_role`), `PATCH /`, `GET /dashboard?date=YYYY-MM-DD`, `GET/POST /members`, `DELETE /members/{userId}` |
| Actors / characters | `GET/POST /actors`, `GET/PATCH/DELETE /actors/{id}`; the same five for `/characters` |
| Scenes | `GET/POST /scenes`, `GET/PATCH/DELETE /scenes/{id}`, `POST /scenes/{id}/clone`, `GET /scenes/{id}/readiness`, `GET /scenes/sides?ids=…` or `?date=…`, `POST /scenes/parse-script` (multipart, preview), `POST /scenes/import`, `POST /scenes/extract-cues`, `PUT/DELETE /scenes/{id}/characters/{characterId}` |
| Costumes | `GET /costumes?q=&status=&category=&source=&characterId=&includeRetired=&page=&pageSize=`, `POST /costumes`, `POST /costumes/import`, `GET /costumes/lookup/{assetNumber}`, `GET/PATCH/DELETE /costumes/{id}`, `POST /costumes/{id}/actions`, `GET /costumes/{id}/timeline`, `/alternatives`, `/qr.png`, `/qr.svg` |
| Changes (looks) | `GET /changes?characterId=`, `POST /changes`, `GET/PATCH/DELETE /changes/{id}`, `POST /changes/{id}/items`, `DELETE /changes/{id}/items/{costumeId}` |
| Fittings | `GET /fittings?characterId=`, `POST /fittings`, `GET/PATCH/DELETE /fittings/{id}`, `POST /fittings/{id}/items`, `PATCH/DELETE /fittings/{id}/items/{costumeId}` |
| Cleaning | `GET /cleaning?open=true`, `POST /cleaning`, `GET/PATCH /cleaning/{id}`, `POST /cleaning/{id}/advance`, `POST /cleaning/{id}/replacement`, `POST /cleaning/emergency` |
| Alterations | `GET /alterations`, `POST /alterations`, `GET/PATCH /alterations/{id}`, `POST /alterations/{id}/advance` |
| Continuity | `GET /continuity?sceneId=&characterId=`, `POST /continuity`, `GET/DELETE /continuity/{id}`, `GET /continuity/compare?sceneId=&characterId=` |
| Photos & references | `GET /photos?entityType=&entityId=`, `POST /photos` (attachment), `POST /photos/link`, `DELETE /photos/{id}`, `GET /photos/gallery?q=&entityType=&characterId=&sceneId=` |
| Damage / missing | `GET /damages?open=true`, `POST /damages`, `PATCH /damages/{id}`; `GET /missing`, `POST /missing`, `PATCH /missing/{id}` |
| Vendors / rentals | `GET/POST /vendors`, `GET/PATCH/DELETE /vendors/{id}`; `GET/POST /rentals`, `PATCH /rentals/{id}`, `POST /rentals/remind` |
| Contacts / requests | `GET/POST /contacts`, `PATCH/DELETE /contacts/{id}`, `POST /requests` |
| Budget | `GET/POST /expenses`, `PATCH/DELETE /expenses/{id}`, `GET /expenses/budget`, `GET /expenses/import/template`, `POST /expenses/import/preview` (multipart), `POST /expenses/import` |
| Comments | `GET /comments?entityType=&entityId=`, `POST /comments`, `DELETE /comments/{id}`, `GET /comments/counts?entityType=` |
| Script cues | `GET /cues?sceneId=`, `PATCH /cues/{id}`, `POST /cues/bulk` |
| Schedule / call sheet | `POST /schedule/parse` (multipart, preview), `POST /schedule/apply` |
| Reports | `GET /reports/daily?date=`, `/reports/daily.csv?date=`, `/reports/budget`, `/reports/inventory`, `/reports/wrap` |
| Notifications / audit | `GET /notifications`, `POST /notifications/read`, `GET /audit?limit=` |
| Service | `GET /meta` (every option list: statuses, categories, cleaning types, pipelines, roles …), `GET /health` |

The iOS file `Network/CSSAPI.swift` has one function per endpoint. Its comments record the body fields that are not in the Postman collection.

### 2.7 Uploads

There are two kinds of upload.

**1. Files the service parses.** Send `multipart/form-data` with a single field named `file`:
- `scenes/parse-script`: Final Draft, Fountain, text or PDF.
- `schedule/parse`: schedule or call sheet as PDF, text, CSV or xlsx.
- `expenses/import/preview`: the budget xlsx.

These calls only return a preview. Nothing is saved until the user confirms and the app calls `scenes/import`, `schedule/apply` or `expenses/import`.

**2. Photos, videos, files and links on a record.** The service **does not take the file**:
- Upload the file to **project storage** (S3 or Box) with the app's existing uploader, the same one the other tools use.
- Then send only the descriptor to `POST /photos`:

```json
{
  "entity_type": "COSTUME", "entity_id": "<id>", "kind": "FRONT", "media_type": "IMAGE",
  "caption": "Front view",
  "attachment": {
    "media": "<storage key>", "thumbnail": "<thumb key>", "name": "front.jpg",
    "content_type": "image", "content_subtype": "jpg",
    "bucket": "<project bucket>", "region": "<aws region>", "file_size": "123456"
  }
}
```

| Field | Values |
| --- | --- |
| `content_type` | `image`, `video` or `document` |
| `media_type` | `IMAGE` or `FILE`; links go to `POST /photos/link` instead |
| `kind` | `FRONT` `SIDE` `BACK` `CLOSEUP` `DETAIL` `STAIN` `REFERENCE` `DOCUMENT` `OTHER` |
| `entity_type` | `COSTUME` `CHANGE` `FITTING` `CONTINUITY` `CLEANING` `DAMAGE` `ALTERATION` `MISSING` `CHARACTER` `ACTOR` |

- Buckets are private. To show a photo, presign its `media` or `thumbnail` key the same way the other Zillit tools do; the raw S3 URL returns 403.
- An empty storage key means the upload failed. Never post a descriptor without a key.

### 2.8 Live updates (Socket.IO)

The events arrive on the **shared Zillit socket**, the same connection the other tools listen on. Every frame carries `project_id`; ignore frames for other projects. The changed record is usually under `data`, and deletes carry `ids` or `id`.

```
costume_set_sync:actor:created|updated|deleted|bulk_updated
costume_set_sync:character:created|updated|deleted|bulk_updated
costume_set_sync:scene:created|updated|deleted|imported|bulk_updated
costume_set_sync:change:created|updated|deleted|bulk_updated
costume_set_sync:costume:created|updated|deleted|imported|bulk_updated
costume_set_sync:fitting:created|updated|deleted|bulk_updated
costume_set_sync:cleaning:created|updated|bulk_updated
costume_set_sync:alteration:created|updated|bulk_updated
costume_set_sync:continuity:updated|deleted|bulk_updated
costume_set_sync:photo:created|deleted
costume_set_sync:damage:created|updated|bulk_updated
costume_set_sync:missing:created|updated|bulk_updated
costume_set_sync:vendor:created|updated|deleted
costume_set_sync:rental:created|updated|bulk_updated
costume_set_sync:contact:created|updated|deleted
costume_set_sync:expense:created|updated|deleted|imported|bulk_updated
costume_set_sync:comment:created|deleted
costume_set_sync:cue:updated|imported|bulk_updated
costume_set_sync:schedule:updated
costume_set_sync:member:updated|deleted
costume_set_sync:settings:updated
costume_set_sync:document:created     (a script was imported, or a schedule / call sheet applied)
```

Recommended handling, as on iOS (`Network/CSSObserver.swift`, `ViewModel/CSSStore.swift`):
- Register all the events once.
- Post one in-app event of the form `(entity, action, payload)`.
- Let every open screen refetch when an entity it shows changes. For example, the costume list refreshes on `costume`, `cleaning`, `damage`, `missing` and `alteration` events, because those change a costume's status.
- After any event, refresh the dashboard counts used by the tab badges.
- After `cleaning`, `missing`, `rental`, `alteration`, `damage` or `fitting` events, also refresh the unread count.
- Guard each refetch:
  - Skip it until the screen's first load has finished.
  - Drop a response if a newer request for the same screen has already been sent; otherwise a slow old response overwrites newer data.

### 2.9 Payload details that are easy to get wrong

These were all real bugs found and fixed on iOS. Build Android to them from the start.

**Response shapes**

1. **Dashboard and daily-report scene rows are summaries, not scenes.** In `dashboard.todays_scenes[].characters[]` and `reports/daily.scenes[].characters[]`, `change` is a **string** ("#1 Look 1", or "—" when none) and readiness is `level`. Decoding them as full scene objects fails the whole response.
2. **Readiness rows** (`GET /scenes/{id}/readiness`) look like `{ scene_character_id, character: {…}, change: {_id, change_number, name} | null, level, items: [{ costume_id, asset_number, name, status, location, level, wear_notes }], blockers: [] }`. There are no flat `character_id` or `character_name` fields. Use `scene_character_id` as the row key.
3. **A character's `scenes`** (`GET /characters/{id}`) are scene-character wrappers `{ _id, scene: {…}, change: {…}, notes }`. Unwrap `scene`, and keep `change` and `notes` alongside it.
4. **`actor.next_fitting` is a timestamp**, not an object.
5. **Members**: `role` is the **effective** role and `assigned_role` is the in-tool assignment (`null` when none). Offer "Remove in-tool role" only when `assigned_role` is set.
6. **`GET /vendors/{id}`** embeds rentals **without** `is_overdue` / `due_soon`. Work out overdue from `return_date` and `status` on that screen.
7. **The costume detail's embedded `fitting_items[].fitting`** has only `_id`, `scheduled_at` and `status`.

**Request fields**

8. **Send request**: crew recipients go in **`crew_user_ids`**, then `vendor_ids` and `contact_ids`. Unknown keys are silently dropped, so `user_ids` notifies nobody.
9. **Costume movements**: `POST /costumes/{id}/actions` takes `{ action, to_location, to_status (STATUS_CHANGE only), scene_id, take_number, note }`. The field is `to_location`, not `location`.
10. **Cancelling cleaning or an alteration** is `POST …/advance` with `{ "to_status": "CANCELLED" }`. The PATCH schemas have no `status`.
11. **Cleaning QC** (`qc_result` PASS / FAIL, `qc_notes`) is sent on the advance call that leaves `QUALITY_CHECK`; FAIL sends the ticket back to CLEANING. PATCH ignores both fields, and also ignores `assigned_to_name`.
12. **Fitting PATCH ignores `character_id`.** The character can't be changed after creation; make the field read-only on edit.
13. **Rental PATCH** ignores `costume_id` and rejects `rate_per_day: null`. `rate_per_day` is **required** on create.
14. **Clearing an enum field** (`int_ext`, `time_of_day`, project `type`, `budget_band`): send `null`, not `""`. The service rejects the empty string.
15. **Clearing a value**: send the key with an empty or null value, depending on the field. A field left out of a PATCH is left unchanged. For example, clearing a change's `wear_notes` means sending `"wear_notes": ""`.
16. **Continuity save** (`POST /continuity`): `{ scene_id, character_id, change_id, take_number, details: { "<label>": "<value>", … }, accessories: [{ name, present }], notes }`. Don't send a details object full of empty values. The server pre-fills from the previous take, and empty values would make every label look changed in `/continuity/compare`.

**Lists and queries**

17. **Comments** are accepted only for `BUDGET`, `EXPENSE`, `ALTERATION`, `DAMAGE`, `MISSING` and `FITTING`; other types answer 406. Only the comment's author can delete it.
18. **Costume list**: the search parameter is `q`, not `search`. `pageSize` is capped at **200**, so page through to load more. Retired costumes are hidden unless `includeRetired=true`.
19. **Script import**: the import only creates characters that appear inside `scenes[].characters`. A character typed in by hand must be added to a scene's `characters`, or it is silently dropped.
20. **Dates sent as `YYYY-MM-DD`** (`dashboard`, `reports/daily`, `schedule/apply`, `sides?date=`) must use the Gregorian calendar and a fixed locale (`Locale.US`), whatever the device's calendar setting is.

**Documents (added 2026-10-02)**

21. **`GET /documents?kind=SCRIPT|SCHEDULE|CALLSHEET`** returns the project's latest full script (Script Distribution), schedule (Schedule Distribution) and call sheet (Home > Call Sheet, not archived or deleted), plus the files imported in the tool, newest first; `latest: true` marks the newest of each kind. Nothing is imported automatically.
    - `POST /scenes/parse-script` and `POST /schedule/parse` accept `document_id` (an `_id` from that list) instead of a file, and return `file_token`.
    - **Always send the form field `kind` (`SCHEDULE` or `CALLSHEET`) to `POST /schedule/parse`**, with a file or with `document_id`. The service treats anything without it as a schedule, so a call sheet's `document_id` fails with "Document does not exist" and an uploaded call sheet is read as a schedule. (A real bug on iOS.)
    - Send `file_token` back in `POST /scenes/import` (with `file_name`) and in `POST /schedule/apply`; the file is then kept in the list. This applies to uploaded files too.
    - `GET /projects/{projectId}` now has `callsheet_source` (`UPLOAD` or `ZILLIT`) and `callsheet_document`; the call sheet header shows the newest call sheet.
    - Read the document record tolerantly: an imported file has a service `url`; a Zillit document may carry project-storage fields (`media` / `bucket` / `region`, flat or under `attachment`) that need presigning. Dates may be epoch ms or ISO strings.

---

## 3. Integration into the Zillit Android app

Mirror what iOS changed outside its module:

| Item | iOS | Android |
| --- | --- | --- |
| Tool identifier | `CONSTANTS.COSTUME_SET_SYNC_TOOL = "costume_set_sync_tool"` | Same key in the tool constants. **Confirm the exact `project/tools` identifier with Shubham.** iOS used this guess, and the tool appeared on DEV. |
| Tool label key | `costume_set_sync_label` | Comes from the backend's `unit_name`, translated as usual |
| Tools page | No group: it appears in **Ungrouped** | Same |
| Tile visibility | Hidden when the user has no view access | Same |
| Tile icon | Existing wardrobe icon (`ic_wardrobe`) | Existing wardrobe icon until design supplies one |
| Info (ⓘ) text | "Break down the script into scenes and characters, number every costume with a QR label, plan each character's changes, record continuity take by take, and run cleaning, alterations, fittings, damage, missing items, vendors, rentals and the costume budget from one place." | Same text |
| Tap | Pushes a full-screen host with the app's navigation bar hidden, because the tool draws its own header | Start the module's Activity, or push its root Fragment, full screen, with the host toolbar hidden |
| Base URL | `ServerRequest.COSTUME_SET_SYNC_BASE_URL = "https://synconsetapi\(env)/api/v2/"` | Add it per environment / flavor, next to the other service hosts |
| Sockets | `SocketIOManager.costumeSetSyncSocketListeners()`, registered with the other tools' listeners | Register the listeners the same way on the shared socket |
| Rights revoked | Leaves the tool when view access is removed or the tool is switched off (tool-rights notifications) | Listen to the same tool-rights updates and close the module |
| Leaving | A back chevron at the top left of the tool's top bar returns to the Tools list. The page-header back square on a section's first page returns to the previous section, and closes the tool when there is none | Same; the system back button behaves like the page-header back square |

### Suggested module structure (Kotlin)

| iOS (`CostumesAndSetSync/`) | Android | Purpose |
| --- | --- | --- |
| `Network/CSSClient.swift` | `network/CssClient.kt` | Builds requests with the app's credentials, retries once on 401, unwraps the `{status, message, data}` response, maps errors (section 2.4) |
| `Network/CSSAPI.swift` | `network/CssApi.kt` | One function per endpoint |
| `Network/CSSObserver.swift` | `network/CssSocket.kt` | Socket listeners → one in-app event stream |
| `Network/CSSUploader.swift` | `network/CssUploader.kt` | Project-storage upload → attachment descriptor; presigned image loading |
| `Model/CSSModels.swift`, `CSSMeta.swift` | `model/*.kt` | Data classes, every field nullable; snake_case → camelCase with `_id` → `id` (for example `@SerialName` or a Gson/Moshi naming policy) |
| `ViewModel/CSSStore.swift` | `CssStore` (one shared ViewModel) | `/meta`, the project and `my_role`, dashboard counts, unread count, lists for pickers (characters, actors, scenes, vendors, contacts, members), the socket event stream, toasts |
| `Views/CSSTheme.swift`, `CSSComponents.swift` | `ui/theme`, `ui/components` | Design tokens and the web components (section 6) |
| `Views/CSSRootView.swift` | `ui/CssShell` | The two-row top navigation |
| `Views/<Area>/*.swift` | `ui/<area>/*` | Screens (section 6.4) |

Use the app's existing UI stack (Compose or Views) and its existing image loader and camera / QR scanner.

---

## 4. First run: "+ Create"

When a Zillit project has no Costumes & Set Sync data yet, the module shows only **+ Create**. Setup then **skips the Feature / TV Series step**, because the type comes from the Zillit project. The full spec, with copy and acceptance criteria, is in this repo: `docs/ZILLIT_FIRST_RUN_CREATE.md` and `docs/ZILLIT_WEB_FIRST_RUN_CREATE.md`.

> **Note:** the iOS module doesn't have this yet; it opens straight into the tool. Android should implement it from the start.

---

## 5. Out of scope inside Zillit

- Login, sign out, change password, switch production, and creating users: Zillit owns these.
- Desktop-only behaviour of the web: drag-and-drop, keyboard shortcuts, hover arrows over tables, the inline header search box (the app uses a search page instead).

---

## 6. UI: match the web app

> **Owner's rule:** the tool must look like the web app on `main`, not like a generic Android list app. When in doubt, open https://costumes-and-set.onrender.com (or the local dev app) and copy it.
>
> **Rules for every screen:**
> - Copy titles, subtitles, red hint lines, button labels, placeholders, empty-state emoji and text, table headers and badge text **literally** from the page's `.tsx` file.
> - Recent wording to copy exactly: "Send reminder request", "… & send", "Schedule & send", "Upload schedule to add characters and shoot date", "Default opening by a cast numbers if no cast number listed alphabetically".
> - Phone layout: where the web squeezes a two-column desktop grid onto a phone, stack the cards in **one column**, in the web's order.

### 6.1 Design tokens (`frontend/src/styles.css`)

| Token | Hex | Used for |
| --- | --- | --- |
| page background `--bg` | `#F4F3EF` | Screen background (warm off-white) |
| surface | `#FFFFFF` | Cards, inputs, top navigation row 1 |
| surface-2 | `#F8F7F4` | Top navigation row 2, subtle fills |
| border | `#E3E1DC` | 1dp hairlines on cards, inputs, rows |
| text / text-2 / text-3 | `#1A1B1F` / `#5B5E66` / `#8B8E96` | Body text / secondary / meta |
| ink | `#14151A` | Primary buttons, active chips |
| accent | `#F2B84B` (text on it `#3D2B00`) | Brand mark, active-tab underline, count pills, accent buttons |
| blue | `#2563EB` | The blue "+ Add" button on Scene Breakdown |
| ok | `#1F9D55`, badge bg `#E4F5EC`, badge text `#146C3B` | |
| info | `#2F6FED`, `#E6EEFC`, `#1D4FB8` | |
| warn | `#D98E00`, `#FFF2D6`, `#8A5A00` | |
| danger | `#D6392C`, `#FDE8E6`, `#A0271C` | |
| muted | `#6B6E76`, `#ECECEA`, `#4D5057` | |
| emergency button | gradient `#E0392C` → `#B8231A` | "Emergency" |

**Shape and spacing**
- Corner radius: cards 12dp; buttons, inputs and icon buttons 10dp; small buttons 8dp; badges fully round.
- Card padding 16dp; screen side padding 14dp; gap 10–14dp.
- Card shadow: very soft, like the web's `0 1px 2px rgba(0,0,0,.05), 0 6px 20px -8px rgba(0,0,0,.15)`.

**Type**
- System sans-serif. Title (h1) 21sp bold; card titles 15sp semibold; body 15sp; meta 13sp.
- Uppercase 12sp grey labels on stat tiles and table headers.
- Monospace for asset numbers (`CST-000245`) and times.

### 6.2 Status colours (the web's `tone()` in `lib/format.ts`)

| Tone | Statuses |
| --- | --- |
| ok (green) | AVAILABLE, READY, COMPLETED, FITTED, PASS, SHOT, FOUND, REPAIRED, RETURNED, OK |
| info (blue) | ISSUED, ON_SET, CLEANING, RECEIVED, DRYING, IRONING, IN_PROGRESS, SHOOTING, PICKED_UP, INFO, SCHEDULED |
| warn (amber) | ALTERATION, ALTERATION_REQUIRED, QUALITY_CHECK, HIGH, WARNING, REPAIRING, PENDING, BOOKED, REQUESTED, ASSIGNED, DUE |
| danger (red) | MISSING, DAMAGED, URGENT, CRITICAL, FAIL, REJECTED, OVERDUE, OPEN, WRITTEN_OFF |
| accent | LEAD |
| muted (grey) | everything else |

Show enum values as words: `STAIN_REMOVAL` → "Stain removal", `ON_SET` → "On set".

### 6.3 Shell: top navigation (`components/Layout.tsx`)

There is **no bottom bar.** Two rows sit at the top; the selected page fills the rest of the screen, and detail pages open under the navigation.

```
┌ Row 1 (white) ── ‹  [C&S]  Movie ABC                          🔍  🔔(20) ┐
│                            Feature · Day 18 · Mumbai Studio             │
├ Row 2 (surface-2, scrolls sideways) ────────────────────────────────────┤
│ (● Costumes)  Dashboard  Scene Breakdown  Character Breakdown ▾          │
│               Costumes (35) ▾  Continuity ▾  Reports  Budget  Gallery    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Row 1**
- **Back chevron** at the far left: the app-coloured "‹" the other Zillit modules (AccountHub, AD Dashboard, Extras Portal) put at the top left. It returns to the Zillit Tools list from any page of the tool.
- C&S mark: 34dp amber rounded square.
- Production name, with "Feature" or "TV Series", "Day N" and the current location under it.
- 38dp bordered icon buttons on the right:
  - **Search**: a page searching scenes (by number, name or location), characters (by name or cast number) and costumes (server `q`, 8 hits).
  - **Bell**: Notifications, with a red unread count.
- **Hidden for now (2026-10-03):** keep these behind a flag, off:
  - **Scan** (QR / asset number). It stays reachable from the Dashboard's **Scan** button.
  - **Gear**: a menu with "name · Role", then **Team & roles** and **Project settings** for managers. While it is hidden those two screens have no entry point.

**Row 2**
- Starts with a "● Costumes" chip, then these tabs:

| Tab | Opens | Count pill |
| --- | --- | --- |
| Dashboard | Dashboard | — |
| Scene Breakdown | Scene Breakdown — **the default when the tool opens** | — |
| Character Breakdown ▾ | Characters · Actors | — |
| Costumes ▾ | Costumes · Fittings · Sink / Cleaning · Alterations · Damage · Missing · QR Labels · Vendors & Rentals | Total of costumes, `fittings_today`, `cleaning`, `alteration`, `damaged`, `missing` and `rentals_due` from `/dashboard` counts. **Red** when damage, missing or rentals due is above 0; otherwise amber. Each menu item shows its own count. |
| Continuity ▾ | On Set · Book | — |
| Reports | Reports | — |
| Budget | Budget — finance roles only | — |
| Gallery | Gallery | — |

- **Active tab:** ink text on white with a 3dp amber underline; it scrolls into view. Inactive tabs are grey.
- Choosing the current tab again returns that section to its first page.
- **Two kinds of back:**
  - The **top-left chevron** always leaves the tool.
  - The **back square** in each page header goes back one page; on a section's first page it goes to the previously opened section, and closes the tool when there is none. The Android system back button behaves like the back square.

### 6.4 Screens

Each row gives the web page to copy and what it must contain.

**Scenes and people**

| Screen | Web source | Must have |
| --- | --- | --- |
| Scene Breakdown | `pages/Scenes.tsx`, `SceneEditRow.tsx`, `BreakdownRowModal.tsx`, `PrincipalsModal.tsx` | Drafts select, "Collapse Scene Number", **Upload script** (accent) with **View script** under it, **Upload schedule** plus the red hint and **View schedule** under it (the View buttons show once `/documents` has one of that kind), "Add to breakdown", search, "All characters" select, chips Today / Upcoming / Scheduled / All scenes, blue **+ Add**, the breakdown **table** (edit ✎, ×, readiness dot, scene #, script day, set, description, principals as cast numbers, shoot date), scrolling sideways inside its card while the **page** scrolls up and down. Don't give the rows their own height-capped vertical scroll sized at runtime: on iOS that left the imported scenes invisible behind the header |
| Script upload | `ScriptUpload.tsx`, `CharacterConfirmation.tsx` | Draft name → file → preview (nothing saved) → Character Confirmation (cast numbers) → import |
| Schedule / call sheet upload | `ScheduleUpload.tsx` | File → review rows per day (tick boxes, "Fills in …", shoot dates) → Apply |
| Scene detail | `pages/SceneDetail.tsx`, `AiCues.tsx` | Crumbs "Scenes / Sc 12"; "Sc 12 · GREEN ROOM - Day"; readiness badge; synopsis notice; **Continuity**, **Edit**; cards Costume readiness (+ Character), Continuity (takes), Costume cues from script (Accept all / Dismiss all / Re-extract) |
| List of Characters | `pages/Characters.tsx` | Subtitle and the red ordering hint; "★ Actors", "# Cast numbers" (editor whose button says **Save**), "+ Character"; tabs "Characters (n)" / "Actors (n)"; cast-number avatar rows |
| Actors | `pages/Actors.tsx`, `ActorModal.tsx` | "All Actors" card with "+ Add" and the table (Name, Character(s), Gender, Age …). Actor form: Measurements with "Add more", talent rep at the bottom |
| Character detail | `pages/CharacterDetail.tsx` | Big avatar, "2. Raj" plus type badge, "Played by … · age … · in N scenes", "Pick a scene" list. Opened from a scene, it shows that scene |
| Change (look) detail | `pages/ChangeDetail.tsx` | Crumbs "Characters / Raj / Change #12", Edit, "Pieces (n)" + "Add piece", Look photos & references, Used in scenes |

**Costumes and departments**

| Screen | Web source | Must have |
| --- | --- | --- |
| Costumes | `pages/Costumes.tsx`, `costume.tsx` | "21 pieces in inventory", **+ Costume**; search; Any status / category / character / source selects; rows with the type emoji thumbnail, mono asset number + name, "Shirt · White · Size L · for Raj", status badge |
| Costume detail | `pages/CostumeDetail.tsx` | Crumbs; big mono asset number; name; status; spec line; **Edit**, **Label**; action card per status (Issue / Return / To set / Move / Report damage / Mark missing / Repaired / Retire …); Details with the QR; Timeline; photos and video |
| Scan | `pages/Scan.tsx` | Camera with Stop / Start camera, amber notice if the camera is unavailable, asset number field + Find, card with status, location and actions, Emergency cleaning |
| QR labels | `pages/Labels.tsx` | Filters, Select all / Clear, tick list, label preview (QR, asset, name, spec, character · source), **Print N labels** |
| Fittings | `pages/Fittings.tsx`, `FittingDetail.tsx` | "Send reminder request", "+ Fitting"; chips All / scheduled / in progress / completed / cancelled; rows with avatar, 📣 / share / 💬 icons, status. Detail: Start fitting / Complete / Cancel, Checklist (+ Piece), Measurements. Form button **Schedule & send** |
| Sink / Cleaning | `pages/Cleaning.tsx`, `CleaningDetail.tsx` | "N open · N completed today"; **Emergency**, "Send reminder request", **+ Request**. Detail: pipeline stepper; Work the ticket (note, "Advance to …", "Mark ready now", "Cancel request"); Replacement on set; History timeline; stain photos |
| Alterations · Damage reports · Missing items | `pages/Alterations.tsx`, `Damages.tsx`, `Missing.tsx` | Lists of full **cards**: asset + name; 📣 / share / 💬; badges (priority, status, Overdue); issue → work; actions ("Quality Check ›", Cancel / "Found", "Write off"); pipeline (alterations); photo row (kind, Photo, Video, Gallery, Scan). Search plus Open / All |
| Vendors & Rentals | `pages/Vendors.tsx` | "Send return reminders", **+ Rental**; tabs Rentals (n) / Vendors (n); rentals table (Costume, Vendor, Pickup, Return, status / overdue) |

**Continuity, reports and admin**

| Screen | Web source | Must have |
| --- | --- | --- |
| On set | `pages/Continuity.tsx` | "Upload callsheet" with **View callsheet** under it, "Continuity book →", red "Click on scene number to add details on set", day card with date field; empty text exactly "Once a schedule and callsheet is uploaded it will appear here."; record-take form (take #, change, details label/value, accessories present ✓, notes, photos); compare takes |
| Continuity book | `pages/Continuity.tsx` | **Print / PDF**, **+ Record take**; tabs "Continuity of prep" / "History of shoot" |
| Budget | `pages/Budget.tsx`, `BudgetSheet.tsx`, `BudgetUpload.tsx` | "Upload budget sheet", **+ Budget**; stat tiles Total spend + one per category (incl. Consumable), Inventory value, Rental committed; tapping a tile filters the lines. Line form: Character under Description; "Pay to"; own category names |
| Reports | `pages/Reports.tsx` | **Print / PDF**; tabs Daily report / Inventory / assets / Wrap; date + **CSV** |
| Gallery | `pages/Gallery.tsx` | "N photos and videos across looks, fittings, continuity, cleaning and damage"; search, Any type / character / scene; photo cards with kind tag |
| Notifications | `pages/Notifications.tsx` | "N unread", **Mark all read**, rows with unread dot |
| Team & roles | `pages/Team.tsx` | Members from Zillit, role select per member (managers) |
| Project settings | `pages/ProjectSettings.tsx` | Status, shooting day (+ help text), location, currency, dates …, **Save**. Title and code are Zillit's, so show them read-only |
| Dashboard | `pages/Dashboard.tsx` | Header with **Scan** (primary) and **Emergency**; ten stat tiles; Today's scenes with each character's readiness; Today's priorities; Inventory by status (each badge opens the filtered costume list); Today at a glance |

**Document viewer** (`components/DocumentViewer.tsx`; iOS `Views/Scenes/CSSDocumentViewer.swift`): opened by View script / View schedule / View callsheet.
- Version picker when there is more than one (latest first), with the source ("from Script Distribution" / "Schedule Distribution" / "Home > Call Sheet", or "imported in Costumes & Set Sync") and date.
- The file: PDF rendered in place; Final Draft, Fountain, text and CSV shown as text; anything else "This file type can't be shown here. Use Open to read it."
- **Open** (full screen) and, for posting users, **Import this script** / **Apply this schedule** / **Apply this call sheet**, which run the normal review with `document_id`.
- The scenes to tick off against the file (script: every scene; schedule: dated scenes by day; call sheet: the scenes on its day), "N/M ticked", the hint "Tick each scene as you find it in the file — anything left unticked is missing from one side.", and the count of undated scenes. Ticks are not saved.

**Shared pieces**

- **Photos & references** (`components/ui.tsx`, used on almost every record):
  - Kind select ("Front ▾"); buttons Photo, Video, Gallery, Scan, Add file, Add link.
  - "Nothing attached yet." when empty.
  - Square thumbnails with the kind tag and ✕ to delete.
- **Discussion** (`Discussion.tsx`): only on the six comment types (item 17).
- **Send request** (`SendRequest.tsx`): crew, vendors and contacts. The result lists the recipients outside the app, with call / WhatsApp / email links.
- **Pickers** for scene, character, vendor, change and costume: "+ New …" at the top, as on the web.
- **Forms** open as bottom sheets: title + ✕ at the top, fields, Cancel and the primary button at the bottom.

---

## 7. Acceptance criteria

- [ ] The tile appears under **Ungrouped** for users with view access to `costume_set_sync_tool`, with the info text.
- [ ] Opening it on a project with the tool switched off shows the "switched off" message, not a crash and not a jump to All Projects.
- [ ] It opens on **Scene Breakdown**, with the two-row top navigation and no bottom bar.
- [ ] The top bar has the back chevron at the top left (it leaves the tool), Search and the bell; Scan and the gear are not shown.
- [ ] After a script and a schedule are imported, every scene is listed in the breakdown table.
- [ ] View script / View schedule / View callsheet appear once the project has a document of that kind and open the viewer; Apply this call sheet opens the review (no "Document does not exist").
- [ ] Every tab and dropdown item in 6.3 opens the right screen; counts match the web; the Budget tab appears only for finance roles.
- [ ] Each screen in 6.4 matches the web page's structure, wording and buttons on a phone.
- [ ] VIEWER, or a user without posting rights, sees no add, edit or delete controls; finance-only figures are hidden from other roles.
- [ ] A change made on the web shows up live on Android through the socket, without pulling to refresh.
- [ ] Photos upload to project storage and show via presigned URLs; the API receives only the descriptor.
- [ ] Script, schedule / call sheet and budget uploads preview first and save only on confirm.
- [ ] Every item in 2.9 behaves as described; each was a real bug on iOS.
- [ ] Expired DEV tokens (5 minutes) recover without the user noticing.
- [ ] Removing view rights or switching the tool off while it's open closes the tool.
- [ ] A new project shows only **+ Create** and skips the type step (section 4).

---

## 8. To confirm with the API team (Shubham)

- The exact tool **identifier** in `project/tools`. iOS assumes `costume_set_sync_tool`.
- The exact fields of a `/documents` record (iOS reads it tolerantly; see item 21).
- Whether `PATCH /projects/{projectId}` accepts `type` and the six date fields, needed by the first-run flow.
- Whether `POST /schedule/parse` takes a `kind` field (SCHEDULE / CALLSHEET), or only detects it.

## 9. References

| What | Where |
| --- | --- |
| iOS module | `Zillit-IOS` → branch `costume-set-sync` → `Zillit/Zillit/Controller/CostumesAndSetSync/` (`Network/CSSAPI.swift` for every request body; `Views/CSSRootView.swift` for the shell; `Views/CSSTheme.swift` and `CSSComponents.swift` for the design system) |
| iOS host changes | `StringConstants.swift`, `NetworkRequest/RequestConstraint.swift`, `Controller/Film Tools/Controller/FilmToolsViewController.swift`, `LocalizedStrings/LocalizedKeys.swift`, `Controller/CNC/Socket/ChatSocketHelper.swift` |
| Web app (UI spec) | `SyncOnSet` → `frontend/src/pages/*.tsx`, `frontend/src/components/*.tsx`, `frontend/src/styles.css`, `frontend/src/lib/format.ts` |
| Backend validation (field names) | `SyncOnSet` → `backend/src/routes/*.ts` (zod schemas, camelCase there; the Zillit service takes snake_case) |
| API collection | `Costumes_and_Set_Sync_DEV.postman_collection.json` + environment (Shubham, 2026-09-29) |
| First-run spec | `docs/ZILLIT_FIRST_RUN_CREATE.md`, `docs/ZILLIT_WEB_FIRST_RUN_CREATE.md` |
