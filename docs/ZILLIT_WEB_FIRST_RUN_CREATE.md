# Zillit web — Costumes & Set Sync first run: "+ Create" without the type step

**For:** the Zillit web application (web.zillit.com), Costumes & Set Sync module
**API:** Costumes & Set Sync service: `https://synconsetapi-dev.zillit.com/api/v2` (DEV) · `synconsetapi-qa` (QA) · `synconsetapi` (prod)
**Status:** to implement

## What changes

1. When a user opens Costumes & Set Sync for a Zillit project that has **no Costumes & Set Sync data yet**, the module shows **only a "+ Create" button**.
2. Tapping **+ Create** starts setup **without the "Select — Feature / TV Series" screen**. The production type is already known from the Zillit project, so it is picked automatically.

The standalone site (costumes-and-set.onrender.com) is out of scope and keeps its current flow.

## Current flow (being replaced inside Zillit)

| Step | Screen | Notes |
| --- | --- | --- |
| Empty state | "Welcome — Let's get started" + **Create a Production** | |
| 1 of 3 | **Select**: Feature / TV Series cards | **Continue** is disabled until one is picked |
| 2 of 3 | Estimated shoot dates | Optional prep / wrap dates, **Skip** allowed |
| 3 of 3 | Upload script for breakdown | Optional; **Continue** without a script is allowed |

## New flow inside Zillit web

| Step | Screen | Notes |
| --- | --- | --- |
| Empty state | Only **+ Create** | See "Empty state" below |
| 1 of 2 | Estimated shoot dates | Same screen as before; **Skip** allowed; no Back button |
| 2 of 2 | Upload script for breakdown | Same screen as before, with **Back** to dates |
| Done | Module opens on Scene Breakdown | |

### Empty state

- **Shown when** `GET /projects/{projectId}` returns `counts.scenes`, `counts.characters`, `counts.costumes` and `counts.actors` all equal to `0`. Ignore `counts.members`: it is at least 1, the person opening the tool.
- **Layout:** the module's normal frame, with the body showing a single centred primary button **+ Create**. No list, no search, no tabs.
- **Who sees the button:** users whose `my_role` can set up the production: `ADMIN`, `PRODUCTION_MANAGER`, `COSTUME_DESIGNER`. Everyone else sees the text "Costumes & Set Sync hasn't been set up for this project yet. Ask a production manager to set it up." and no button.
- If the API answers `403` with `costume_set_sync_tool_not_enabled` or `role_forbidden`, keep the existing handling and don't show the empty state.

### "+ Create": type picked automatically

- **Source of the type:** read it from the same `GET /projects/{projectId}` response, field `type`:

  | `type` | Means | Effect in the module |
  | --- | --- | --- |
  | `FEATURE` | Feature film | Standard scene breakdown |
  | `EPISODIC` | TV series | Episode column and episode filters are on |

- **Name:** don't ask for one. The production is the Zillit project, and its name is already `project_name`.
- **Fallback:** if `type` is empty or any other value, show the old **Select (Feature / TV Series)** screen first, as step 1 of 3, and save the choice with `PATCH /projects/{projectId}` `{ "type": "FEATURE" | "EPISODIC" }`. Setup must never be blocked.

### Step 1 of 2: shoot dates

- Same fields as today: shoot start / end, an optional **Add prep dates** (prep start / end), an optional **Add wrap dates** (shoot wrap, prep wrap).
- **Continue** saves the dates with `PATCH /projects/{projectId}`. Dates are epoch milliseconds, and `0` means not set:
  `start_date`, `end_date`, `prep_start_date`, `prep_end_date`, `wrap_date`, `prep_wrap_date`.
- **Skip** moves on without saving any dates.
- **Cancel** returns to the empty state. If anything was entered, it first asks "Discard changes?" with **Keep editing** and **Discard**.

### Step 2 of 2: upload script for breakdown

- Same screen as today: draft name (default "White") and the drop zone for Final Draft, text or PDF.
- **With a file:** `POST /projects/{projectId}/scenes/parse-script` (preview) → the user confirms → `POST /projects/{projectId}/scenes/import`, then open the module on Scene Breakdown.
- **Without a file:** **Continue** opens the module on Scene Breakdown, now empty but set up.
- **Back** returns to step 1 with the dates as entered.

## Copy

| Where | Text |
| --- | --- |
| Empty state button | `+ Create` |
| Empty state, no permission | `Costumes & Set Sync hasn't been set up for this project yet. Ask a production manager to set it up.` |
| Step header | `Create a production · step 1 of 2` / `step 2 of 2` |
| Fallback header | `Create a production · step 1 of 3` (only when the type is unknown) |

## Acceptance criteria

- [ ] A Zillit project with all counts at `0` opens Costumes & Set Sync to a screen with only **+ Create**, for Admin, Production Manager and Costume Designer.
- [ ] Other roles see the "hasn't been set up" message and no button.
- [ ] For a `FEATURE` project, **+ Create** opens directly on the shoot dates screen labelled "step 1 of 2"; the Feature / TV Series screen never appears.
- [ ] For an `EPISODIC` project, the same applies, and after setup the Episode column and filter are present.
- [ ] Shoot dates entered in step 1 are saved to the project, and **Skip** saves none.
- [ ] A script uploaded in step 2 creates the scenes; continuing without one still finishes setup.
- [ ] After setup, reopening the module goes straight to Scene Breakdown, not the empty state.
- [ ] A project with no or unknown `type` shows the Feature / TV Series screen first, as step 1 of 3, and saves the choice.
- [ ] **Cancel** asks before discarding entered dates and returns to the empty state.

## To confirm with the API team

- `PATCH /projects/{projectId}` accepts `type` and the six date fields. The DEV collection only shows `currency`, `shooting_day`, `current_location`, `status` and `city`.
- `type` is filled in from the Zillit project on the first `GET /projects/{projectId}`, and its possible values.
- "All counts 0" is the right signal for "not set up yet", or the API returns an explicit flag instead.

## Reference

The current wizard and empty state, which this replaces inside Zillit, are in the Costumes & Set Sync repo:
- `frontend/src/pages/ProductionWizard.tsx`: step 0 is the type picker, then dates, then script. `STEPS` is the step count, and `type` is `FEATURE` / `EPISODIC`.
- `frontend/src/pages/Projects.tsx`: the "Welcome — Let's get started" empty state.
