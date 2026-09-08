# Deploying Costumes & Set

The app ships as **one container**: the Express API serves the built web app, so a single web service with a
persistent disk is all that is needed. The container runs `backend/scripts/start.sh`, which creates the data
directory, syncs the Prisma schema, optionally seeds the demo production, and starts the server on `PORT`.

| Variable | Default (container) | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `JWT_SECRET` | *(required)* | Signing key for login tokens. Use a long random string. |
| `DATA_DIR` | `/data` | Persistent directory for the SQLite DB and uploads (mount a volume here) |
| `DATABASE_URL` | `file:/data/sink.db` | Prisma connection string. Use `postgresql://…` after switching the provider |
| `UPLOAD_DIR` | `/data/uploads` | Photo storage |
| `SEED_DEMO` | unset | `true` seeds the "Movie ABC" demo project on first start (safe to leave on: idempotent) |
| `CORS_ORIGIN` | `*` | Allowed browser origins for the API (same-origin deploys can leave `*`) |

## Option A — Render (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vivekzillit/SyncOnSet)

`render.yaml` defines a Docker web service with a 2 GB disk at `/data`, a generated `JWT_SECRET`, health checks on
`/api/health`, and auto-deploy from `main`. Persistent disks need the Starter plan; on the Free plan the app still runs
but the SQLite database resets on every deploy (fine for a demo).

## Option B — Fly.io (one command, persistent volume)

```bash
brew install flyctl && fly auth login
fly launch --copy-config --yes          # uses fly.toml; creates the app in region bom
fly volumes create data --region bom --size 2
fly secrets set JWT_SECRET="$(openssl rand -hex 32)"
fly deploy
fly open
```

## Option C — Any Docker host (VPS, Railway, DigitalOcean, Coolify…)

Every push to `main` publishes `ghcr.io/vivekzillit/costumes-and-set:latest` via GitHub Actions. On the host:

```bash
docker run -d --name costumes-and-set --restart unless-stopped \
  -p 80:4000 -v sink_data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" -e SEED_DEMO=true \
  ghcr.io/vivekzillit/costumes-and-set:latest
```

Or build locally: `docker build -t costumes-and-set . && docker run -p 4000:4000 -v sink_data:/data -e JWT_SECRET=dev costumes-and-set`.

## Moving to PostgreSQL (recommended for multi-user production)

1. In `backend/prisma/schema.prisma` change `provider = "sqlite"` to `"postgresql"`.
2. Set `DATABASE_URL=postgresql://user:pass@host:5432/costumesandset` on the service (Render/Fly both offer managed Postgres).
3. Redeploy; `start.sh` runs `prisma db push` against the new database. For a migration history use `npm run db:migrate` locally and commit `prisma/migrations`.

## Uploads at scale

Photos are stored on the mounted disk. For multi-region or object storage, point `UPLOAD_DIR` at a mounted bucket
(e.g. S3 via s3fs) or swap the multer disk storage in `backend/src/routes/photos.ts` for an S3 client.

## After the first deploy

1. Sign in as `admin@costumesandset.app` / `password123`, go to **Team & roles**, create your real users, then deactivate
   or re-password the demo accounts.
2. Set `SEED_DEMO=false` and redeploy once real data is in.
3. Print QR labels from **QR Labels** and tag the inventory.
