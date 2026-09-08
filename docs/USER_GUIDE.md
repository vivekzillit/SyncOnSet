# Costumes & Set — start-to-finish guide

How a costume department runs a production in Costumes & Set, from the first day of prep to wrap.
Screen names and buttons are written exactly as they appear in the app.

Live app: https://costumes-and-set.onrender.com · Demo password for every demo account: `password123`

---

## 0. Get in

1. Open the app and **sign in**. On a desktop the production's tabs run across the top, SyncOnSet-style: **Costumes** (the department), **Dashboard**, **Scenes**, **Breakdown**, **Characters ▾** (Characters, Actors), **Costumes ▾** (Costumes, Scan, Sink / Cleaning, Fittings, Alterations, Damage, Missing, QR Labels, Vendors & Rentals), **Continuity ▾** (On Set, Book), **Reports ▾**, **Gallery**, with a search box that finds scenes, characters and costumes by number or name. On a phone, add it to the home screen (Safari: Share → Add to Home Screen; Chrome: menu → Install app) so it opens full-screen with the bottom navigation **Home · Scenes · Costumes · Scan · Sink · More**.
2. **Change your password** straight away: on desktop click the key icon next to your name at the bottom of the sidebar; on a phone go to **More → Change password**.
3. Pick your production on the **Projects** screen. Everything after this happens inside one production.

Who does what:

| Role | Sees | Does |
| --- | --- | --- |
| Admin, Production Manager, Costume Designer, Costume Supervisor | Everything, including budgets | Set up the production, breakdown, team, approvals |
| Costume Assistant, Wardrobe Assistant, Dresser | Everything except money | Day-to-day: scan, issue, return, cleaning, continuity, fittings, damage |
| Laundry | The Sink board and costume details | Works cleaning tickets |
| Tailor | Alterations and costume details | Works alteration tickets |
| Continuity | Continuity (On Set and Book), scenes, costumes | Records takes and photos |
| Actor | Their scenes, changes and fittings | Read-only |

## 1. Set up the production (managers)

1. **Projects → Create a Production**. A six-step wizard asks what you are working on (feature or feature TV series), the title, the studio, and the estimated dates: prep start and end, then shoot start and end. **Upload script for breakdown** follows: name the draft (for example "White" or "Blue") and drop in the screenplay, or press **Continue** to create the production without one and upload the script later from the Scenes page.
   - **Character Confirmation** follows the upload, as in SyncOnSet: every speaking role found in the script is listed with its scene and line counts. **Delete** anything that is not a character (a sound, a sign, a crowd); **Delete All** imports the scenes without any characters, **Skip** imports everything as listed. **Continue** imports the scenes and characters and opens the Scenes list. Cast numbers are set later on each character's page.
2. **Project settings** (sidebar): prep and shoot dates, notes. Update **Shooting day** and **Current location** each shoot day; both show on the dashboard and reports.
3. **Team & roles**:
   - **New user** creates an account with a temporary password and adds it to this production (Admin and Production Manager only).
   - **Add member** adds an existing user by name or email and sets their project role. Change a role any time from the dropdown next to their name.
   - The key icon next to a member resets their password; the bin icon removes them from this production.
4. **Vendors & Rentals → Vendors → + Vendor** for every costume house, tailor and shop you will use.

## 2. Break down the script

1. **Scenes → Upload script**. Drop in the screenplay as Final Draft (`.fdx`), Fountain (`.fountain`), plain text or a PDF exported from the writing software. The app reads the scene numbers, INT/EXT, location, time of day, page length in eighths, the characters who speak in each scene and a one-line synopsis, and shows a preview in two tabs:
   - **Scenes**: each scene is marked **New**, **Updated** (the text changed since the last upload) or **Unchanged**. Untick any scene you do not want. Give the upload a **Revision name** such as "Blue 2026-09-08"; it is stamped on new and updated scenes only, so unchanged scenes keep any edits you made by hand.
   - **Characters**: speaking roles are read from the capitals in the script and listed with their scene and line counts. A name that matches an existing character merges into it automatically; **Delete** anything that is not a character (a sound effect, a sign, a crowd). Non-speaking roles are added to scenes afterwards with **+ Character** on the scene; cast numbers are set on each character's page.
   - Nothing is ever deleted by an upload: revised drafts add scenes and characters, update sluglines, and mark omitted scenes. If the writers renumbered scenes, fix the numbers in the app before uploading, or the changes will land on the wrong scenes.
   - Tick **Also extract costume cues after import** and the app reads every imported scene for wardrobe facts with its built-in script reader: garments and accessories mentioned (including Indian wear such as kurta, saree, sherwani, dupatta, bangles), colours and fabrics, condition (wet, torn, bloodied, muddy), costume changes, continuity links (later, continuous, flashback, same clothes) and things to prepare for (fights, rain, food, blood, water). No AI or internet is needed. You can also run it later from any scene's **Costume cues from script** card (**Extract**). If the server has an Anthropic key, the same reader uses AI for deeper reading instead.
   - Cues appear on each scene under **Costume cues from script** as suggestions with the supporting line from the script. **Accept** the ones the department agrees with, **Dismiss** the rest, or **Accept all**. Accepting never creates changes or costumes by itself; it is a checklist for building the looks. **Re-extract** on a scene refreshes the suggestions and keeps your decisions.
2. **Scenes → Upload schedule** and **Upload callsheet** work exactly like the script upload, but on the production's own paperwork. Drop in the shooting schedule (a one-line schedule PDF from Movie Magic, StudioBinder or Celtx, or a CSV) or the day's callsheet, and the breakdown is read straight from it: the shoot dates, and for every scene the set, INT/EXT, day or night, page count, cast numbers and the one-line synopsis. A callsheet PDF is read by its table columns, so the scene table comes out as a table rather than a jumble.
   - The preview is the same as the script's: one row per scene, showing what the file says and what the scene has today. Edit any date, untick anything you do not want, then **Apply**.
   - Two tick boxes decide how much is written: **Add scenes that are not in the breakdown yet** creates them, and **Fill in blank details on existing scenes** completes what is missing. What a scene already has is never overwritten, and nothing is deleted.
   - Cast numbers on the callsheet are linked to characters that carry the same cast number, so the Principals column fills in too.
   - Scenes get their shoot date and turn **Scheduled**, so they show under **Today** and **Upcoming**. Tomorrow's advance block is dated the next day, not today, and scenes named only in continuity notes ("same saree as Sc 4") are left alone. Dates written as 03/04/2026 are read as day/month and flagged.
3. **Scenes → Import breakdown** is the manual alternative: paste one scene per line as `number | name | location | INT/EXT | DAY/NIGHT | script day | characters (comma separated)`.
4. **The Scenes table** works like SyncOnSet's: columns for the readiness light, Scene #, Script Day, Script Loc (INT/EXT and location), Scene Description, Principals (cast numbers), Shoot Date and a row menu with **Edit**, **Clone**, **Omit** and **Delete**. Pick a draft at the top to see one revision, search across numbers, locations and descriptions, and use the Today / Upcoming / All chips. **+ Add** opens an inline row (scene number, script day, INT/EXT and location, description, principals via **Add/Remove**, shoot date) with Save and Cancel; **Edit All** turns every visible row editable with one **Save all**. Set the **Shoot date** as soon as the schedule is out: the dashboard, the Scan screen and the continuity book all key off it.
5. **Characters & Actors**:
   - **Actors** tab → **+ Actor**: name, contact, agency and **measurements** (height, chest, waist, hips, inseam, shoe…). These show on every fitting for that actor, so shoppers and tailors never have to ask.
   - **Characters** tab → **+ Character**: name, type (Lead, Supporting, Day player, Background), age, the actor playing them, and a description of the look.
   - On a character's page, **References** takes anything the department works from: photographs, a file of any kind (a PDF lookbook, a spreadsheet, a supplier quote) and links out to a shared drive or mood board. The same applies to a look, a costume, a fitting, a cleaning ticket and a damage report. Files that a browser could run, such as .html and .svg, are refused; export them as PDF or attach a link instead.
5. Open a scene and use **+ Character** to add anyone the script upload missed, such as non-speaking roles. The change (look) can be assigned later.

## 3. Build the wardrobe

1. **Costumes → + Costume** for every physical piece: name, category (Clothing, Accessory, Footwear, Jewellery, Prop), type, colour, size, brand, fabric, the character it is for, where it is right now, its source (Purchased, Rented, Borrowed, Stock, Custom made, Designer, Actor's own) and, for finance roles, cost. Leave the asset number blank to get the next `CST-000123` automatically.
   - A purchased piece with a cost books a purchase expense automatically.
   - Multiples of the same garment (three identical white shirts) are three separate pieces, so each can be tracked, cleaned and replaced on its own.
2. **QR Labels**: filter, tick the pieces, **Print**. Tag every garment and bag, and later use the same labels on wrap boxes. The label carries asset number, description, size, character and source.
3. **Vendors & Rentals → Rentals → + Rental** for every rented piece: vendor, rate per day, pickup and return dates. The list shows what is due soon or overdue, and **Send return reminders** notifies the team a day ahead.

## 4. Create the looks (changes)

A change is one numbered outfit for one character, made of pieces from the inventory.

1. Open the character → **+ Change**: name it the way the breakdown does ("Change 12 – Restaurant, white shirt and jeans"), describe it, and **Add piece** for every garment and accessory.
2. On the change page, click a piece's wear notes line to record how it is worn: "sleeves rolled twice, top button open". This text follows the piece into the continuity book.
3. Add **look photos** (front, side, back, close-up) from the change page.
4. Open each scene and use the **Change** dropdown next to every character to say which change they wear. The **Costume readiness** light on the scene turns green when every piece in the assigned change is available; it turns amber for alteration, blue for cleaning, red for missing or damaged, and grey when no change is assigned.

## 5. Fittings and alterations

1. **Fittings → + Fitting**: character, date and time, where, and the pieces to try. The actor's measurements appear on the fitting page.
2. During the fitting press **Start fitting**, then for each piece mark **Fitted**, **Pending**, **Alteration** or **Reject**, and add notes ("half size big, insole added"). Take photos.
   - **Alteration** asks for the issue, what is required and a deadline, then creates the tailoring ticket and sends the piece to the tailor in one step.
3. Press **Complete** when done.
4. **Alterations** (tailor or supervisor): each ticket moves **Requested → Assigned → In progress → Quality check → Completed** with the advance button. Completing it returns the piece to Available, and the scene readiness updates by itself.

## 6. Shoot day

### Morning
1. **Dashboard**: today's scenes with a readiness line for every character, and **Today's priorities** (missing, damaged, alterations, cleaning, rentals due, fittings today).
2. Fix anything red or amber before the actors arrive; each priority links to its page.

### Getting costumes out
3. **Scan** (bottom bar or sidebar): point the camera at the label, or type the asset number. Set the **Scene** and **Take** in the context box once; every action from this screen carries them.
4. Press **Issue to actor** when the piece leaves the truck, and **Send to set** when the actor walks on. Every action is time-stamped in the piece's timeline with who did it.

### On set
5. **Continuity → On Set** (Continuity role or wardrobe) opens straight into the take form: choose the scene and the character, and the form is ready. Take 1 is prefilled from the assigned change; each later take is prefilled from the previous one, so you only change what changed. Tick pieces present or not, add notes, and **Scan** a label (or type its asset number) to add the piece the actor is wearing. **Save take** clears the form for the next take.
   - **Continuity → Book** is the record: every take for that scene and character, with photos front, side and back, and the automatic flags between takes.
   - The book compares takes automatically and flags differences ("Ring missing in Take 3", "Sleeves: Rolled → Down").
6. **Something spills**: scan the piece and press **Emergency clean**. Describe the problem, pick the cleaning type, and leave **Auto-assign the best available replacement** ticked. The app marks the piece as in cleaning, alerts laundry and the supervisor, and issues the closest matching spare (same type, size, colour, character) to the actor. The result screen lists other candidates with an **Assign** button if you prefer a different one.
7. **Request cleaning** (not urgent), **Report damage** and **Mark missing** are on the same screen. Damage and missing reports alert the managers and turn the piece red on every scene it belongs to.

### Laundry
8. **Sink / Cleaning**: the board shows every ticket by stage; emergencies sit on top with a red edge. Open a ticket, press **Assign to me**, then **Advance** through **Received → Cleaning → Drying → Ironing → Quality check**. At quality check press **QC pass → Ready** or **QC fail → back to cleaning**. Ready returns the piece to the wardrobe and notifies the team. Stain photos can be attached to the ticket.

### End of day
9. Scan each piece back with **Return to wardrobe**. Anything still out shows on the dashboard as issued.
10. Check **Missing** and **Damage** are empty or actioned. Found pieces: **Missing → Found**, enter where.
11. **Reports → Daily report**: scenes, costumes used, issued, returned, cleaning, emergencies, alterations, damage, missing. **Print / PDF** for the production report, **CSV** for the movement log.

## 7. Money and reports (finance roles)

1. **Budget & Expenses**: totals by category, character and scene. **+ Expense** for anything not booked automatically. Purchases, rental returns and completed repairs post their own expense lines.
2. **Reports → Inventory / assets**: every piece with source, vendor, cost, status and location; **CSV** for the accountant or insurer.
3. **Notifications** (bell): cleaning completed, replacements, alterations, damage, missing, rentals due. **Mark all read** when caught up.
4. **Gallery**: every photo in the production in one grid, filterable by what it shows (costume, look, character, fitting, continuity take, cleaning, damage), by character or scene, and by search. Click a photo to see it large and jump to its record.

## 8. Wrap

1. **Vendors & Rentals → Rentals**: mark each rental **Returned**; the rental cost posts to the budget.
2. **Reports → Wrap**: every active piece grouped by source, so the team knows what goes back to vendors, what goes to storage and what belongs to actors. Print it.
3. **QR Labels**: print box labels for storage boxes.
4. Pieces that are sold, lost or destroyed: open the piece and **Retire** (managers), or write off from **Damage** / **Missing**.
5. **Project settings**: status **Wrap**, then **Archived** when the books are closed. The data stays searchable.

## 9. Housekeeping for the person running the deployment

- Demo accounts: change the admin password on first use, then reset or remove the other demo users from **Team & roles** once the real team is in.
- On Render, set `SEED_DEMO=false` after real data is entered so a redeploy never re-seeds the demo.
- Costume cues work out of the box with the built-in script reader. Optionally set `ANTHROPIC_API_KEY` on the server (Render → Environment) to have AI read scenes instead; the model is `claude-opus-5` by default (`ANTHROPIC_MODEL` overrides it) and a feature-length script costs a few cents.
- The current Render service is on the Free plan: the database and photos reset on every deploy and the app sleeps after 15 minutes idle. Before real use, upgrade to Starter with a persistent disk, or move to PostgreSQL. Steps are in [DEPLOY.md](DEPLOY.md).

## Status glossary

| Status | Meaning | Set by |
| --- | --- | --- |
| Available | In the wardrobe, ready to issue | Return, cleaning ready, alteration completed, repaired, found |
| Issued | With the actor or dresser | Issue to actor |
| On set | On the actor on set | Send to set |
| Cleaning | With laundry | Request cleaning, Emergency clean |
| Alteration | With the tailor | Alteration request, fitting marked Alteration |
| Damaged | Damage reported, not usable | Report damage |
| Missing | Cannot be found | Mark missing |
| Returned to vendor | Rental returned | Rental marked Returned |
| Retired | Sold, written off, destroyed | Retire, write off |

## Day-one checklist

- [ ] Project created, shooting day and location set
- [ ] Team added with the right roles, demo passwords changed
- [ ] Scenes imported with shoot dates
- [ ] Actors with measurements, characters linked to actors
- [ ] Every piece in inventory and labelled
- [ ] Changes built with pieces and wear notes, assigned to scenes
- [ ] Scene readiness green for tomorrow's scenes
- [ ] Fittings done, alterations completed
- [ ] Laundry and tailor accounts able to sign in on their phones
