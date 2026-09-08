# Costumes & Set — Technical Specification (v0.1)

## 1. Product objective

Give the costume department a single system covering the full lifecycle:

**Script → Character → Scene → Change → Costume → Fitting → Shoot → Cleaning → Continuity → Wrap**

Design principles
1. **Mobile-first on set.** The wardrobe assistant can do everything from a phone: scan, issue, return, clean, photograph.
2. **Every physical movement is an event.** Status and location are never edited directly; they are the result of an action, so the costume timeline is complete.
3. **Readiness is derived, not entered.** Scene readiness rolls up from the statuses of the pieces in each character's assigned change.
4. **Role-appropriate visibility.** Money is hidden from laundry, tailors, dressers and actors.
5. **Provider-neutral data model.** SQLite for MVP, PostgreSQL for production, without schema changes.

## 2. Users & roles

| Role | Typical person | Manager | Ops | Cleaning | Tailoring | Continuity | Finance |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: |
| ADMIN | System admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| PRODUCTION_MANAGER | Line producer / PM | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| COSTUME_DESIGNER | Designer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| COSTUME_SUPERVISOR | Dept head | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| COSTUME_ASSISTANT | Day-to-day ops | | ✓ | ✓ | ✓ | ✓ | |
| WARDROBE_ASSISTANT | Issue/return, scan | | ✓ | ✓ | ✓ | ✓ | |
| DRESSER | Dresses actors | | ✓ | ✓ | ✓ | ✓ | |
| LAUNDRY | Cleaning team | | | ✓ | | | |
| TAILOR | Alterations | | | | ✓ | | |
| CONTINUITY | Script supervisor / continuity | | | | | ✓ | |
| ACTOR | Cast (read-only) | | | | | | |

Capability groups (backend `src/lib/constants.ts`, mirrored in frontend `src/state/auth.tsx`):

- **Manager** — create/edit projects, scenes, characters, actors, changes; manage members; delete records.
- **Ops** — create/edit costumes; issue/return/move; emergency cleaning; damage & missing reports; replacements; fittings; vendors/rentals.
- **Cleaning** — create cleaning requests and advance tickets through the pipeline.
- **Tailoring** — create alteration requests and advance them.
- **Continuity** — record takes and upload photos.
- **Finance** — see purchase/rental costs, expenses, budget report.

Membership is per project (`ProjectMember.role`). `ADMIN` is global. A global `User.role` is the default when a user is added to a project.

## 3. Modules

A. Projects · B. Script & scenes · C. Characters & actors · D. Changes (looks) · E. Costume catalogue/inventory ·
F. QR scan · G. Issue / return / movements · H. Sink / cleaning (incl. emergency) · I. Scene readiness ·
J. Fittings · K. Alterations · L. Continuity book · M. Photos · N. Damage · O. Missing · P. Vendors & rentals ·
Q. Budget & expenses · R. Reports & labels · S. Notifications · T. Team & roles · U. Audit log.

## 4. Data model

25 tables (Prisma, `backend/prisma/schema.prisma`). Enum-like columns are strings validated by zod against
`constants.ts`. JSON blobs (measurements, continuity details) are stored as text and parsed at the API boundary.

```
User ──< ProjectMember >── Project
Project ──< Actor ──< Character ──< CostumeChange ──< CostumeChangeItem >── Costume
Project ──< Scene ──< SceneCharacter >── Character  (SceneCharacter.changeId → CostumeChange)
Costume ──< CostumeMovement (timeline)
Costume ──< CleaningRequest ──< CleaningLog ; CleaningRequest.replacementCostumeId → Costume
Costume ──< AlterationRequest, DamageReport, MissingItem, FittingItem, Rental, Expense
Character ──< Fitting ──< FittingItem
Scene/Character/CostumeChange ──< ContinuityRecord (unique per scene+character+take)
Photo (polymorphic: entityType + entityId)  Vendor ──< Costume, Rental
Notification (per user)  AuditLog
```

Key fields
- **Character**: `castNumber` (call-sheet number), type, actor link.
- **Scene**: slugline fields, `pages` (eighths), `scriptDay`, `shootDate`, `status`, `scriptText`, `revision`, `revisedAt`.
- **Costume**: `assetNumber` (unique, e.g. `CST-000245`, auto-generated if omitted), `category`, `type`, `color`, `brand`, `size`, `fabric`, `quantity`, `source`, `purchaseCost`, `rentalCostPerDay`, `vendorId`, `characterId`, `status`, `location`, `careInstructions`, `isRetired`.
- **CostumeChange**: `changeNumber` unique per character; items carry `wearNotes` ("sleeves rolled, top button open").
- **SceneCharacter**: the costume requirement — which change a character wears in a scene.
- **CleaningRequest**: `problem`, `cleaningType`, `priority`, `status`, `isEmergency`, `expectedReadyAt`, `qcResult`, `replacementCostumeId`, logs.
- **ContinuityRecord**: `details` `{ "Sleeves": "Rolled twice" }`, `accessories` `[{ name, present }]`, `notes`, photos.

### Costume status machine

```
AVAILABLE ─ISSUE→ ISSUED ─TO_SET→ ON_SET ─RETURN→ AVAILABLE
any of {AVAILABLE, ISSUED, ON_SET} ─CLEANING_REQUESTED→ CLEANING ─CLEANING_COMPLETE→ AVAILABLE
                                     ─ALTERATION_REQUESTED→ ALTERATION ─ALTERATION_COMPLETE→ AVAILABLE
                                     ─MARK_DAMAGED→ DAMAGED ─REPAIRED→ AVAILABLE   ─RETIRE→ RETIRED
any ─MARK_MISSING→ MISSING ─FOUND→ AVAILABLE
RENTED ─RETURN_TO_VENDOR→ RETURNED_TO_VENDOR ─RECEIVED→ AVAILABLE
MOVE changes location only. SCAN is a no-op timeline marker.
```

Every transition writes a `CostumeMovement` (from/to status + location, scene, take, user, note) and an `AuditLog` row.

### Cleaning pipeline

`REQUESTED → RECEIVED → CLEANING → DRYING → IRONING → QUALITY_CHECK → READY` (+ `CANCELLED`).
`advance` moves one step; at `QUALITY_CHECK`, `qcResult: FAIL` sends the ticket back to `CLEANING`.
Reaching `READY` applies `CLEANING_COMPLETE` to the costume and notifies ops roles.
Default expected-ready times per cleaning type (spot 30 min … dry cleaning 24 h) are applied when none is given.

### Emergency flow (`POST …/cleaning/emergency`)

1. Create an URGENT request (`isEmergency: true`) — by `costumeId` or scanned `assetNumber`.
2. Costume → `CLEANING`, location `Laundry`, timeline + audit entries.
3. Notify LAUNDRY + manager roles (CRITICAL).
4. Rank alternatives: same project, `AVAILABLE`, same category; +5 same type, +4 size, +3 colour, +3 same character, +2 same name, +1 brand; threshold ≥ 5.
5. Optionally auto-assign the best match: it inherits the character, is `ISSUE`d to the actor with a "Replacement for …" note, and managers are notified.

### Alteration pipeline

`REQUESTED → ASSIGNED → IN_PROGRESS → QUALITY_CHECK → COMPLETED` (+ `CANCELLED`). Completion returns the costume to `AVAILABLE`.
A fitting item marked `ALTERATION_REQUIRED` creates the alteration automatically.

### Scene readiness

For each `SceneCharacter`: no change → `NOT_ASSIGNED`; otherwise the worst piece status in the change, ordered
`MISSING > DAMAGED > ALTERATION > CLEANING > NOT_ASSIGNED > READY`. Scene level = worst character level.

### Script upload (tier 1, deterministic)

`POST …/scenes/parse-script` accepts `.fdx`, `.fountain`, `.txt` and `.pdf` (text extracted with pdf-parse). Every format is
normalised into an element stream (heading, character, dialogue, action, other) by `backend/src/services/scriptParser.ts`:
Final Draft paragraphs map by their `Type` attribute; text formats use screenplay heuristics (sluglines start with INT/EXT/I/E/EST,
character cues are short upper-case lines followed by dialogue, transitions end in TO:, page numbers and CONTINUED markers are noise).
Sluglines yield `intExt`, `location` and `timeOfDay` (MORNING → DAY, LATER → CONTINUOUS, SUNSET → DUSK…); scene numbers come from
FDX attributes, Fountain `#24#` markers or margin numbers, falling back to order of appearance with a warning. Character names are
normalised (extensions stripped, title case). The response is a preview only; the client confirms via `POST /import`, which upserts
scenes by number and matches characters case-insensitively, storing each scene's text in `Scene.scriptText`.

The preview compares each parsed scene's text with the stored text and labels it `new`, `updated` or `unchanged`, estimates
its length in eighths (`pages`, from line counts at ~55 lines per page), and lists detected characters against existing ones.
Import takes a `revision` name (stamped as `Scene.revision`/`revisedAt` on new and updated scenes only; unchanged scenes are
not rewritten so manual edits survive), a `characterMap` (detected name → existing character to merge into, or `null` to
ignore non-characters) and `castNumbers` for characters created by the import (`Character.castNumber`). Uploads never delete
scenes or scene-character links, mirroring SyncOnSet's revision behaviour; omitted headings set status OMITTED.

### Sides

`GET …/scenes/sides?date=YYYY-MM-DD` or `?ids=` returns the day's scenes with slugline data, page counts, revision, cast
numbers and stored text; the Sides screen renders them as a cover sheet plus screenplay-formatted pages with a name-and-date
watermark for printing.

### AI costume cues (tier 2, advisory)

`POST …/scenes/extract-cues { sceneIds }` (managers, up to 10 scenes per call; the client chunks for progress) sends each
scene's stored text to the Claude API (`claude-opus-5` by default, `ANTHROPIC_MODEL` to override) with a costume-breakdown
system prompt and a structured-output schema, and stores the result as `ScriptCue` rows: `character`, `kind`
(GARMENT, ACCESSORY, CONDITION, CHANGE, CONTINUITY, NOTE), `text` (≤ 20 words), a verbatim `quote`, `confidence`, and
`status` SUGGESTED → ACCEPTED | DISMISSED via `PATCH …/cues/:id` or `POST …/cues/bulk`. Re-extraction replaces SUGGESTED
cues and keeps decided ones. Batches are ~6 scenes or 24k characters; the system prompt is cached. The feature is off unless
`ANTHROPIC_API_KEY` is set on the server (`GET /meta` reports `aiEnabled`); refusals, auth failures and rate limits map to
502/503/429 with plain-language messages. Cues never create changes or costumes: they are a checklist for the designer.

## 5. API reference

Base URL `/api`. JSON everywhere except photo upload (multipart) and QR/CSV downloads. Auth: `Authorization: Bearer <JWT>`
(7-day tokens; `?token=` accepted for `<img>`/download URLs). Errors: `{ error, details? }` with 400/401/403/404/409/500.

### Auth & users
| Method | Path | Notes |
| --- | --- | --- |
| POST | /auth/login | `{email,password}` → `{token,user,projects}` |
| GET | /auth/me | current user + memberships |
| POST | /auth/change-password | |
| GET | /users?q= | managers |
| POST | /users | admin / PM: `{name,email,password,role,phone}` |
| GET/PATCH | /users/:id | |
| GET | /meta | all enum values (roles, statuses, cleaning types, locations…) |

### Projects
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | /projects | my projects / create |
| GET/PATCH | /projects/:id | |
| GET | /projects/:id/dashboard?date= | counts, priorities, today's scenes with readiness |
| GET/POST | /projects/:id/members · DELETE /members/:userId | |
| GET | /projects/:id/audit | managers |

### Project-scoped (`/projects/:projectId/…`)
| Resource | Endpoints |
| --- | --- |
| actors | GET, POST, GET/:id, PATCH/:id, DELETE/:id (measurements as JSON object) |
| characters | GET, POST, GET/:id (scenes, changes, costumes, fittings, photos), PATCH, DELETE |
| scenes | GET (?date=&status=, includes readiness, hasScript, revision), POST, POST /parse-script (multipart screenplay → preview with new/updated/unchanged, pages, detected characters), POST /import (`scenes`, `revision`, `characterMap`, `castNumbers`), GET /sides (?date= or ?ids=), GET/:id, GET/:id/readiness, PATCH, DELETE, PUT /:id/characters/:characterId `{changeId,notes}`, DELETE /:id/characters/:characterId |
| changes | GET (?characterId=), POST `{characterId,name,changeNumber?,costumeIds?}`, GET/:id, PATCH, DELETE, POST /:id/items `{costumeId,wearNotes}`, DELETE /:id/items/:costumeId |
| costumes | GET (?q=&status=&category=&characterId=&source=&location=&page=&pageSize=), POST (auto asset number), POST /import, GET /lookup/:assetNumber (scan; logs SCAN), GET/:id (timeline, photos, tickets), PATCH, DELETE, POST /:id/actions `{action,toLocation,sceneId,takeNumber,note,toStatus}`, GET /:id/timeline, GET /:id/alternatives, GET /:id/qr.png?size=, GET /:id/qr.svg |
| fittings | GET (?status=&characterId=), POST `{characterId,scheduledAt,location,notes,costumeIds}`, GET/:id, PATCH, DELETE, POST /:id/items, PATCH /:id/items/:costumeId `{status,notes,alteration?}`, DELETE /:id/items/:costumeId |
| cleaning | GET (?open=true&status=&costumeId=) → `{pipeline,items}`, POST, POST /emergency `{costumeId|assetNumber,sceneId,takeNumber,problem,cleaningType,autoAssignReplacement}`, GET/:id (alternatives, photos), PATCH, POST /:id/advance `{toStatus?,note,qcResult,qcNotes,returnLocation}`, POST /:id/replacement `{costumeId}` |
| alterations | GET (?open=true), POST, GET/:id, PATCH, POST /:id/advance |
| cues | GET (?status=&characterId=&sceneId=), PATCH/:id `{status,text,characterId}`, POST /bulk `{ids,status}`; scenes: POST /extract-cues `{sceneIds}` |
| continuity | GET (?sceneId=&characterId=), POST (upsert by scene/character/take; prefilled from previous take), GET /compare?sceneId=&characterId= → `{records,flags}`, GET/:id, DELETE/:id |
| photos | GET (?entityType=&entityId=), POST multipart `file,entityType,entityId,kind,caption`, DELETE/:id |
| damages | GET (?open=true), POST, PATCH/:id (`REPAIRED` books a DAMAGE expense; `WRITTEN_OFF` retires) |
| missing | GET (?status=), POST, PATCH/:id `{status:FOUND,foundLocation}` |
| vendors | GET, POST, GET/:id, PATCH, DELETE |
| rentals | GET (with `isOverdue`,`dueSoon`), POST, PATCH/:id (`RETURNED` books a RENTAL expense), POST /remind |
| expenses | finance roles: GET, POST, PATCH, DELETE, GET /budget |
| notifications | GET (?unread=true) → `{items,unread}`, POST /read `{ids?}` |
| reports | GET /daily?date=, GET /daily.csv, GET /inventory[?format=csv], GET /budget (finance), GET /wrap |

## 6. Screens (web app, 27)

Login · Projects · **Dashboard** · Scan · Scenes · Scene detail (readiness, change assignment, takes, tickets) ·
Characters & actors · Character detail (changes, scenes, pieces, measurements, fittings, photos) · Change detail (pieces, wear notes, photos, scenes) ·
Costumes (search/filter/paginate, create) · Costume detail (QR, actions, used-in, photos, records, timeline) ·
Sink/Cleaning board (kanban + list) · Cleaning ticket (stepper, work actions, QC, replacement, history, stain photos) ·
Fittings · Fitting detail (checklist, alteration on the spot, measurements, photos) · Continuity book (takes, flags, record take) ·
Alterations · Damage reports · Missing items · Vendors & rentals · Budget & expenses · Reports (daily / inventory / wrap, CSV, print) ·
QR labels (select & print) · Notifications · Team & roles · Project settings · More (mobile menu).

Mobile: bottom navigation **Home | Scenes | Costumes | Scan | Sink | More**, camera capture on all photo inputs, one-hand action bars.

## 7. QR workflow

- Payload = asset number (plain text) so any scanner app also reads it.
- `GET …/costumes/:id/qr.png` renders the code server-side; the Labels screen prints garment tags / wrap-box labels
  (asset, description, size, character, source, vendor).
- Scan → `GET /costumes/lookup/:assetNumber` → status, location, character, changes, scenes, open tickets → contextual actions
  (Issue, To set, Return, Move, 🚨 Emergency clean, Request cleaning, Alteration, Damage, Missing, Found, Repaired, Retire).

## 8. Notifications

Events: cleaning requested / emergency / completed, replacement assigned, alteration requested / completed, damage, missing,
rental due / overdue, fitting scheduled. Fan-out creates one row per targeted member (role-targeted; admins always included)
so read state is per user. Web app polls unread count every 30 s (swap for WebSocket/push in Phase 2).

## 9. Reports

- **Wardrobe daily report** — scenes, costumes used, issued/returned, cleaning (incl. emergencies), alterations, damage, missing, spend; CSV of movements.
- **Inventory / asset report** — all assets with source, vendor, cost (finance only), status, location; CSV.
- **Wrap report** — assets grouped by source (rented → vendor, purchased → storage, actor's own…).
- **Budget** — totals by category / character / scene, inventory value, rental commitment.

## 10. Security

JWT (HS256) with bcrypt passwords; project membership enforced on every scoped route; role guards per route; money fields
redacted server-side for non-finance roles; zod validation on all bodies; image-only uploads (15 MB); audit log of writes.
Production checklist: strong `JWT_SECRET`, HTTPS, PostgreSQL, object storage for uploads, rate limiting on `/auth/login`.

## 11. iOS client & offline (Phase 2 design)

- **SwiftUI app** consuming the same REST API; feature modules mirror the web screens; bottom tab bar identical to mobile web.
- **Local store:** Realm (or SwiftData) mirrors `Costume`, `Scene`, `SceneCharacter`, `CostumeChange(+Items)`, `Character`, `Actor`, today's `CleaningRequest`s and `ContinuityRecord`s.
- **Sync design:** every mutating action is appended to an `OutboxOperation` (id, type, payload, createdAt, clientId).
  While offline the app applies the operation optimistically to the local store; when online it replays the outbox in order
  (`POST /sync/ops` — to be added — accepts a batch, returns per-op result + server version). Server rules:
  - movements/cleaning/continuity are **append-only** → always accepted (ordered by client timestamp).
  - status conflicts (e.g. two devices issuing the same costume) → server applies the later action and returns the current
    costume so the client reconciles; the earlier device shows a "changed elsewhere" toast.
  - photos upload after metadata, with retry.
- Read model: `GET /sync/changes?since=<cursor>` returns changed rows (all tables carry `updatedAt`) for delta refresh.

## 12. Roadmap (sprints, 2 weeks each)

| Sprint | Scope |
| --- | --- |
| 0 | ✔ This repo: schema, API, seed, web app, reports, labels, roles, docs |
| 1 | Pilot on one production: bulk inventory import from Excel, photo thumbnails, PDF daily report, e-mail/WhatsApp notifications |
| 2 | Offline outbox + delta sync API; PWA install; camera improvements |
| 3 | SwiftUI iOS app (scan, issue/return, cleaning, continuity, fittings) |
| 4 | Multi-unit / multi-location, shooting schedule import (Movie Magic / Excel), day-out-of-days |
| 5 | AI: continuity photo comparison (advisory), NL costume search, stain triage (advisory). Script breakdown and costume-cue extraction shipped in sprint 0 |
