# Costumes & Set — start-to-finish guide

How a costume department runs a production in Costumes & Set, from the first day of prep to wrap.
Screen names and buttons are written exactly as they appear in the app.

Live app: https://costumes-and-set.onrender.com · Demo password for every demo account: `password123`

---

## 0. Get in

1. Open the app and **sign in**. On a phone, add it to the home screen (Safari: Share → Add to Home Screen; Chrome: menu → Install app) so it opens full-screen with the bottom navigation **Home · Scenes · Costumes · Scan · Sink · More**.
2. **Change your password** straight away: on desktop click the key icon next to your name at the bottom of the sidebar; on a phone go to **More → Change password**.
3. Pick your production on the **Projects** screen. Everything after this happens inside one production.

Who does what:

| Role | Sees | Does |
| --- | --- | --- |
| Admin, Production Manager, Costume Designer, Costume Supervisor | Everything, including budgets | Set up the production, breakdown, team, approvals |
| Costume Assistant, Wardrobe Assistant, Dresser | Everything except money | Day-to-day: scan, issue, return, cleaning, continuity, fittings, damage |
| Laundry | The Sink board and costume details | Works cleaning tickets |
| Tailor | Alterations and costume details | Works alteration tickets |
| Continuity | Continuity book, scenes, costumes | Records takes and photos |
| Actor | Their scenes, changes and fittings | Read-only |

## 1. Set up the production (managers)

1. **Projects → New project**: title, a short code (used on labels and reports), status (Prep), current location, currency.
2. **Project settings** (sidebar): start and end dates, notes. Update **Shooting day** and **Current location** each shoot day; both show on the dashboard and reports.
3. **Team & roles**:
   - **New user** creates an account with a temporary password and adds it to this production (Admin and Production Manager only).
   - **Add member** adds an existing user by name or email and sets their project role. Change a role any time from the dropdown next to their name.
   - The key icon next to a member resets their password; the bin icon removes them from this production.
4. **Vendors & Rentals → Vendors → + Vendor** for every costume house, tailor and shop you will use.

## 2. Break down the script

1. **Scenes → Upload script**. Drop in the screenplay as Final Draft (`.fdx`), Fountain (`.fountain`), plain text or a PDF exported from the writing software. The app reads the scene numbers, INT/EXT, location, time of day, page length in eighths, the characters who speak in each scene and a one-line synopsis, and shows a preview in two tabs:
   - **Scenes**: each scene is marked **New**, **Updated** (the text changed since the last upload) or **Unchanged**. Untick any scene you do not want. Give the upload a **Revision name** such as "Blue 2026-09-08"; it is stamped on new and updated scenes only, so unchanged scenes keep any edits you made by hand.
   - **Characters**: speaking roles are read from the capitals in the script. Confirm them before importing: give new characters a **cast number**, **merge** misspellings or duplicates into the right character, and **ignore** anything that is not a character (a sound effect, a sign, a crowd). Non-speaking roles are added to scenes afterwards with **+ Character** on the scene.
   - Nothing is ever deleted by an upload: revised drafts add scenes and characters, update sluglines, and mark omitted scenes. If the writers renumbered scenes, fix the numbers in the app before uploading, or the changes will land on the wrong scenes.
   - Tick **Also extract costume cues with AI after import** (when the server has an AI key) and the app reads every imported scene for wardrobe facts: garments and accessories mentioned, condition (wet, torn, bloodied), costume changes, continuity links and things to prepare for (fights, rain, food). You can also run this later from **Scenes → AI cues**, for all scenes or just today's.
   - Cues appear on each scene under **Costume cues from script** as suggestions with the supporting line from the script. **Accept** the ones the department agrees with, **Dismiss** the rest, or **Accept all**. Accepting never creates changes or costumes by itself; it is a checklist for building the looks. **Re-extract** on a scene refreshes the suggestions and keeps your decisions.
2. **Scenes → Import breakdown** is the manual alternative: paste one scene per line as `number | name | location | INT/EXT | DAY/NIGHT | script day | characters (comma separated)`.
3. Or **Scenes → + Scene** for single scenes. Set the **Shoot date** as soon as the schedule is out: the dashboard, the Scan screen and the continuity book all key off it.
4. **Sides**. **Scenes → Sides** (or the Sides link in the menu) prints the script pages for a shoot day from the uploaded text: a cover with the scene list, story days, page counts and cast numbers, then each scene laid out as a screenplay, watermarked with your name and the date. Pick the date at the top and **Print**. A single scene's sides open from **Sides** on the scene page.
5. **Characters & Actors**:
   - **Actors** tab → **+ Actor**: name, contact, agency and **measurements** (height, chest, waist, hips, inseam, shoe…). These show on every fitting for that actor, so shoppers and tailors never have to ask.
   - **Characters** tab → **+ Character**: name, type (Lead, Supporting, Day player, Background), age, the actor playing them, and a description of the look.
6. Open a scene and use **+ Character** to add anyone the script upload missed, such as non-speaking roles. The change (look) can be assigned later.

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
5. **Continuity book** (Continuity role or wardrobe): choose the scene and the character, press **Record take**. Take 1 is prefilled from the assigned change; each later take is prefilled from the previous one, so you only change what changed. Tick accessories present or not, add notes, and photograph front, side and back on the take card.
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

## 8. Wrap

1. **Vendors & Rentals → Rentals**: mark each rental **Returned**; the rental cost posts to the budget.
2. **Reports → Wrap**: every active piece grouped by source, so the team knows what goes back to vendors, what goes to storage and what belongs to actors. Print it.
3. **QR Labels**: print box labels for storage boxes.
4. Pieces that are sold, lost or destroyed: open the piece and **Retire** (managers), or write off from **Damage** / **Missing**.
5. **Project settings**: status **Wrap**, then **Archived** when the books are closed. The data stays searchable.

## 9. Housekeeping for the person running the deployment

- Demo accounts: change the admin password on first use, then reset or remove the other demo users from **Team & roles** once the real team is in.
- On Render, set `SEED_DEMO=false` after real data is entered so a redeploy never re-seeds the demo.
- To turn on AI costume cues, set `ANTHROPIC_API_KEY` on the server (Render → Environment). Without it the buttons explain that AI is not configured; everything else works. The model is `claude-opus-5` by default (`ANTHROPIC_MODEL` overrides it); a feature-length script costs a few cents to read.
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
