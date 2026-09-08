# Costumes & Set

**The digital wardrobe & costume management platform for film and TV production.**
*From wardrobe to set. Every costume. Every scene. Every take.*

Costumes & Set gives the costume department one system for the whole life of a garment:

> Script → Character → Scene → Change (look) → Costume → Fitting → Shoot → Cleaning → Continuity → Wrap

It is modelled on the workflows of tools like SyncOnSet-for-Costumes (script breakdown, numbered changes, a digital
continuity book, asset-numbered inventory, wrap-box labels, per-character/per-scene budgets) and adds an on-set
**"Sink"**: an emergency cleaning pipeline with automatic replacement suggestions.

---

## What's in the box

| Area | Highlights |
| --- | --- |
| **Breakdown** | Upload the screenplay (Final Draft, Fountain, text, PDF) to build scenes, sluglines, page counts and characters; revised drafts are diffed (new / updated / unchanged) and stamped with a revision name; character confirmation (delete non-characters; names matching existing characters merge automatically); costume cues read from the script text per scene (built-in reader, AI optional) with accept/dismiss; printable sides per shoot day |
| **Changes / looks** | Numbered outfits per character, pieces with wear notes, scene ↔ change assignment |
| **Inventory** | Asset numbers (`CST-000245`), QR codes, category/type/size/colour/source/vendor, location, status, full timeline |
| **Scan** | Camera QR scanning (or typed asset number) → status, location, scenes, and contextual actions |
| **Issue / return** | Issue to actor, send to set, return, move; every movement is logged |
| **Sink / cleaning** | 13 cleaning types, priority, kanban board through Requested → Received → Cleaning → Drying → Ironing → QC → Ready |
| **🚨 Emergency** | One tap: URGENT ticket, costume marked unavailable, laundry + supervisor alerted, replacement found and issued |
| **Scene readiness** | Per-scene, per-character traffic light derived from the assigned change's costume statuses |
| **Continuity book** | Per scene/character/take: wear details, accessories, notes, photos; automatic diff flags between takes |
| **Fittings** | Checklist per piece; "Alteration required" raises a tailoring ticket on the spot |
| **Alterations, damage, missing** | Ticket pipelines with costume status side-effects and notifications |
| **Vendors & rentals** | Rental bookings, due/overdue tracking, return reminders |
| **Budget** | Expenses by category, character and scene; inventory value; rental commitments |
| **Reports** | Wardrobe daily report (CSV), asset inventory (CSV), wrap report, printable QR / wrap-box labels |
| **Production setup** | SyncOnSet-style wizard: feature / feature TV series, title, studio, prep and shoot dates, required script upload and Character Confirmation |
| **Actors & gallery** | Actors page with cast, contacts, next fitting and start dates; Gallery of every photo in the production |
| **Roles** | 11 roles; laundry/tailors never see money; managers control breakdown and team |
| **Notifications** | Per-user in-app notifications with unread badge |
| **Audit** | Every write is audit-logged |

## Quick start

Requirements: Node 20+. No database server needed (SQLite).

```bash
npm run setup     # installs backend + frontend, generates Prisma client, creates DB, seeds demo data
npm run dev       # API on http://localhost:4000, web app on http://localhost:5173
```

Then open <http://localhost:5173> and sign in with any demo account (password `password123`):

| Role | Email |
| --- | --- |
| Admin | admin@costumesandset.app |
| Production manager | pm@costumesandset.app |
| Costume designer | designer@costumesandset.app |
| Costume supervisor | supervisor@costumesandset.app |
| Costume assistant | assistant@costumesandset.app |
| Wardrobe assistant | wardrobe@costumesandset.app |
| Dresser | dresser@costumesandset.app |
| Tailor | tailor@costumesandset.app |
| Laundry | laundry@costumesandset.app |
| Continuity | continuity@costumesandset.app |
| Actor | actor@costumesandset.app |

The seed creates the demo production **Movie ABC** (Raj, Priya, Inspector Pandey…, 21 costumes, 11 scenes, open
cleaning/alteration/damage/missing items) so every screen has data on first run.

Try the headline flow: **Scan → type `CST-000245` → Emergency clean → Raise emergency**.

## Project layout

```
backend/            Express + TypeScript + Prisma (SQLite) REST API
  prisma/schema.prisma   data model (25 tables)
  prisma/seed.ts         demo production
  src/lib/constants.ts   every status / enum value (single source of truth)
  src/services/          costume actions & timeline, cleaning pipeline, readiness, reports
  src/routes/            one router per module, mounted under /api/projects/:projectId/...
  uploads/               photo storage (local disk)
frontend/           React 18 + Vite + TypeScript + TanStack Query, mobile-first
  src/pages/             one file per screen (27 screens)
  src/components/        UI kit, QR scanner, photo grid, timeline, costume actions
  src/state/             auth + project context, role helpers
docs/TECHNICAL_SPEC.md  full technical specification
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` (root) | runs API and web app together |
| `npm run build` (root) | builds both; the API serves `frontend/dist` in production |
| `npm start` (root) | starts the built API (serves the SPA too) on `PORT` |
| `backend: npm run db:reset` | wipe and re-seed the SQLite DB |
| `backend: npm run db:migrate` | create a Prisma migration (when you change the schema) |
| `backend/frontend: npm run typecheck` | TypeScript checks |

## Configuration

`backend/.env`

```
DATABASE_URL="file:./dev.db"          # or postgresql://user:pass@host/db (change provider in schema.prisma)
JWT_SECRET="change-me"
PORT=4000
UPLOAD_DIR="uploads"
CORS_ORIGIN="http://localhost:5173"
ANTHROPIC_API_KEY=""            # optional: AI reads scenes for costume cues instead of the built-in reader
```

**Moving to PostgreSQL:** the schema uses plain string columns instead of DB enums/JSON so it is provider neutral.
Change `provider = "sqlite"` to `"postgresql"` in `prisma/schema.prisma`, set `DATABASE_URL`, run `npm run db:migrate`.

## API at a glance

All project resources live under `/api/projects/:projectId/…` and require `Authorization: Bearer <jwt>`.

```
POST /api/auth/login                       GET /api/auth/me            GET /api/meta (all enums)
GET|POST /api/projects                     GET /api/projects/:id/dashboard
…/actors  …/characters  …/scenes (+ /import, /:id/readiness, PUT /:id/characters/:characterId)
…/changes (+ /:id/items)
…/costumes (+ /lookup/:assetNumber, /:id/actions, /:id/timeline, /:id/alternatives, /:id/qr.png, /import)
…/fittings (+ /:id/items/:costumeId)
…/cleaning (+ /emergency, /:id/advance, /:id/replacement)
…/alterations (+ /:id/advance)   …/continuity (+ /compare)   …/photos (multipart)
…/damages   …/missing   …/vendors   …/rentals (+ /remind)   …/expenses (+ /budget)
…/notifications (+ /read)   …/reports/daily[.csv] | /inventory[?format=csv] | /budget | /wrap
```

New to the app? Start with the [start-to-finish user guide](docs/USER_GUIDE.md).

See [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) for the complete reference, data model, state machines,
permission matrix, screen list, iOS/offline architecture and the sprint roadmap.

## Deploy

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vivekzillit/SyncOnSet)

The app ships as a single Docker image (API + built web app) with a `/data` volume for the database and photos.
`render.yaml` and `fly.toml` are included, and every push to `main` publishes `ghcr.io/vivekzillit/costumes-and-set:latest`.
See [docs/DEPLOY.md](docs/DEPLOY.md) for Render, Fly.io, plain Docker and the PostgreSQL switch.

## Roadmap

- **Phase 1 (this repo):** everything listed above — enough to trial on a real production.
- **Phase 2:** offline mode with sync queue (mobile), push notifications, multi-project switching polish,
  scheduled rental reminders, PDF export, photo thumbnails/CDN, SwiftUI iOS app on the same API.
- **Phase 3 (AI):** continuity photo comparison (advisory), natural-language costume search, stain-photo cleaning
  recommendation (advisory). Script breakdown and costume-cue extraction already ship.
