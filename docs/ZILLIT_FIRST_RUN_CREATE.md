# Costumes & Set Sync inside Zillit — first run and "+ Create"

**Status:** to implement · **Applies to:** Costumes & Set Sync when it is opened inside the Zillit app (iOS module and web.zillit.com). The standalone web app (costumes-and-set.onrender.com) keeps its current flow.

## Summary

When Costumes & Set Sync is opened inside Zillit for a project that has no Costumes & Set Sync data yet, the screen shows only a **+ Create** button. Tapping it starts production setup **without** the "Select — Feature / TV Series" step, because the type is already known from the Zillit project.

## Today

1. The module opens on the productions list. With no data it shows a "Welcome — Let's get started" empty state with **Create a Production**.
2. **Create** opens the setup wizard at `/projects/new`, **step 1 of 3: Select**, where the user must pick **Feature** or **TV Series** before **Continue** is enabled.
3. Step 2 of 3: estimated shoot dates (optional prep / wrap dates, Skip allowed).
4. Step 3 of 3: upload a script for breakdown (optional), then the production opens.

Inside Zillit the user is already in a project, and that project already says whether it is a feature or a series, so step 1 asks a question whose answer is known.

## Required behaviour

### 1. First run: empty state shows only "+ Create"

- **When:** the module is opened inside Zillit and the current Zillit project has no Costumes & Set Sync production or data yet.
- **Show:** an empty screen with a single primary **+ Create** button. No productions list, no search, no other actions.
- **Who sees the button:** only roles that can create a production (today: Admin, Production Manager, Costume Designer). Other roles see a short message instead of the button, e.g. "Costumes & Set Sync hasn't been set up for this project yet. Ask a production manager to set it up."
- Once data exists, the module opens normally and the empty state is not shown again.

### 2. "+ Create" skips the type step

- Tapping **+ Create** opens setup **directly on the shoot dates step**.
- The **Select (Feature / TV Series)** screen is not shown.
- The production type is set automatically from the Zillit project:

  | Zillit project | Costumes & Set Sync `type` |
  | --- | --- |
  | Feature film | `FEATURE` |
  | TV series / episodic | `EPISODIC` |

- The step counter reads **step 1 of 2** (dates) and **step 2 of 2** (script upload), not "of 3".
- **Back** is not shown on the dates step, because it is now the first step. **Cancel** returns to the empty state, asking "Discard changes?" if anything was entered.
- Everything after the type step is unchanged: shoot / prep / wrap dates with Skip, then the optional script upload, then the production opens.

### 3. Fallback when the type can't be determined

If the Zillit project has no type, or a value that maps to neither row above, show the existing **Select (Feature / TV Series)** step as today (3 steps). Setup must never be blocked.

## Things to confirm before building

- **Zillit project type field:** the name of the field on the Zillit project that holds feature vs series, and its exact values, so the mapping table above can be finalised.
- **Production name:** inside Zillit the production should probably take the Zillit project's name. Today the standalone wizard names it after the uploaded script, or "Untitled Feature / Series".
- **What counts as "no data yet":** the suggested rule is no Costumes & Set Sync production linked to the current Zillit project. Confirm with the API team (`synconsetapi`) which call answers this.

## Acceptance criteria

- [ ] Inside Zillit, a project with no Costumes & Set Sync data opens to a screen showing only **+ Create**, for roles that can create.
- [ ] Roles that cannot create see an explanatory message and no button.
- [ ] Tapping **+ Create** for a feature project opens the dates step; the saved production has `type = FEATURE`.
- [ ] Tapping **+ Create** for a series project opens the dates step; the saved production has `type = EPISODIC`, and episode features (Ep columns and filters) are available.
- [ ] The step counter reads "of 2", and there is no Back button on the first step.
- [ ] A project with an unknown or missing type still shows the Feature / TV Series step.
- [ ] Cancel from setup returns to the empty state and asks before discarding entered dates.
- [ ] The standalone web app (costumes-and-set.onrender.com) is unchanged: Create still starts at Select, step 1 of 3.

## Implementation notes

**Web (this repo):**
- `frontend/src/pages/ProductionWizard.tsx` holds the wizard. Step 0 is the type picker, `STEPS` is the step count, and `f.type` holds `FEATURE` / `EPISODIC`.
- Let the wizard take a preset type. When it is present, set `f.type`, start at the dates step, and count 2 steps: hide Back on the dates step and show "step N of 2".
- `frontend/src/pages/Projects.tsx` renders the empty state (`Empty` with **Create a Production**). Inside Zillit, replace it with the single **+ Create** button.

**iOS (Zillit-IOS, `Controller/CostumesAndSetSync/`):**
- The same two changes in the module's root screen and its create flow. The project type is read from the current Zillit project rather than asked.
