/* Demo seed: "Movie ABC" production matching the Sink on Set blueprint. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const today = new Date();
const at = (h: number, m = 0, dayOffset = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m);
const dayOnly = (offset = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);

async function main() {
  const password = await bcrypt.hash("password123", 10);
  const usersData = [
    { name: "Vivek Mishra", email: "admin@sinkonset.app", role: "ADMIN" },
    { name: "Meera Iyer", email: "pm@sinkonset.app", role: "PRODUCTION_MANAGER" },
    { name: "Anita Desai", email: "designer@sinkonset.app", role: "COSTUME_DESIGNER" },
    { name: "Rahul Verma", email: "supervisor@sinkonset.app", role: "COSTUME_SUPERVISOR" },
    { name: "Sana Khan", email: "assistant@sinkonset.app", role: "COSTUME_ASSISTANT" },
    { name: "Deepak Rao", email: "wardrobe@sinkonset.app", role: "WARDROBE_ASSISTANT" },
    { name: "Pooja Nair", email: "dresser@sinkonset.app", role: "DRESSER" },
    { name: "Ramesh Tailor", email: "tailor@sinkonset.app", role: "TAILOR" },
    { name: "Suresh Laundry", email: "laundry@sinkonset.app", role: "LAUNDRY" },
    { name: "Nikhil Continuity", email: "continuity@sinkonset.app", role: "CONTINUITY" },
    { name: "Arjun Kapoor", email: "actor@sinkonset.app", role: "ACTOR" },
  ];
  const users: Record<string, { id: string; name: string; role: string }> = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({ where: { email: u.email }, update: { name: u.name, role: u.role }, create: { ...u, passwordHash: password } });
    users[u.role] = user;
  }

  const project = await prisma.project.upsert({
    where: { code: "ABC" },
    update: {},
    create: {
      name: "Movie ABC",
      code: "ABC",
      status: "SHOOTING",
      shootingDay: 18,
      currentLocation: "Mumbai Studio",
      currency: "INR",
      startDate: dayOnly(-30),
      endDate: dayOnly(45),
      notes: "Feature film. Unit A shooting at Mumbai Studio, Unit B on location from next week.",
    },
  });
  const pid = project.id;
  const already = await prisma.character.count({ where: { projectId: pid } });
  if (already > 0) {
    console.log("Demo project already seeded; skipping.");
    return;
  }

  for (const u of Object.values(users)) {
    await prisma.projectMember.upsert({ where: { projectId_userId: { projectId: pid, userId: u.id } }, update: {}, create: { projectId: pid, userId: u.id, role: u.role } });
  }

  // Actors
  const arjun = await prisma.actor.create({ data: { projectId: pid, name: "Arjun Kapoor", phone: "+91 98XXXXXX01", measurements: JSON.stringify({ height: "183 cm", chest: "40", waist: "32", inseam: "33", shoe: "10", collar: "15.5" }), notes: "Prefers slim fit shirts. Allergic to wool." } });
  const kriti = await prisma.actor.create({ data: { projectId: pid, name: "Kriti Sharma", phone: "+91 98XXXXXX02", measurements: JSON.stringify({ height: "168 cm", bust: "34", waist: "27", hips: "36", shoe: "6" }) } });
  const vikram = await prisma.actor.create({ data: { projectId: pid, name: "Vikram Singh", measurements: JSON.stringify({ chest: "44", waist: "38", shoe: "11" }) } });
  const junior = await prisma.actor.create({ data: { projectId: pid, name: "Rohan (Junior Artist)", measurements: JSON.stringify({ chest: "38", waist: "30" }) } });

  // Characters
  const raj = await prisma.character.create({ data: { projectId: pid, name: "Raj", type: "LEAD", age: 35, actorId: arjun.id, description: "Successful architect, clean, modern, understated." } });
  const priya = await prisma.character.create({ data: { projectId: pid, name: "Priya", type: "LEAD", age: 30, actorId: kriti.id, description: "Journalist. Bold colours, statement earrings." } });
  const inspector = await prisma.character.create({ data: { projectId: pid, name: "Inspector Pandey", type: "SUPPORTING", age: 50, actorId: vikram.id, description: "Mumbai police inspector, khaki uniform." } });
  const waiter = await prisma.character.create({ data: { projectId: pid, name: "Waiter", type: "DAY_PLAYER", actorId: junior.id } });
  const mother = await prisma.character.create({ data: { projectId: pid, name: "Raj's Mother", type: "SUPPORTING", age: 62 } });

  // Vendor
  const xyz = await prisma.vendor.create({ data: { projectId: pid, name: "XYZ Costumes", contactName: "Farhan", phone: "+91 22 XXXX XXXX", email: "rentals@xyzcostumes.example", address: "Andheri West, Mumbai" } });
  const zara = await prisma.vendor.create({ data: { projectId: pid, name: "Zara (Phoenix Mall)", phone: "+91 22 XXXX XXXX" } });

  // Costumes
  const mk = async (data: Parameters<typeof prisma.costume.create>[0]["data"]) => prisma.costume.create({ data });
  const whiteShirt = await mk({ projectId: pid, assetNumber: "CST-000245", name: "White Formal Shirt", category: "CLOTHING", type: "Shirt", color: "White", brand: "Zara", size: "L", fabric: "Cotton", source: "PURCHASED", purchaseCost: 3500, vendorId: zara.id, characterId: raj.id, status: "ON_SET", location: "Set", careInstructions: "Cold wash, no bleach." });
  const whiteShirt2 = await mk({ projectId: pid, assetNumber: "CST-000247", name: "White Formal Shirt (dup 2)", category: "CLOTHING", type: "Shirt", color: "White", brand: "Zara", size: "L", fabric: "Cotton", source: "PURCHASED", purchaseCost: 3500, vendorId: zara.id, characterId: raj.id, status: "AVAILABLE", location: "Wardrobe Truck" });
  const whiteShirt3 = await mk({ projectId: pid, assetNumber: "CST-000251", name: "White Formal Shirt (dup 3)", category: "CLOTHING", type: "Shirt", color: "White", brand: "Zara", size: "L", fabric: "Cotton", source: "PURCHASED", purchaseCost: 3500, vendorId: zara.id, characterId: raj.id, status: "AVAILABLE", location: "Wardrobe Truck" });
  const jeans = await mk({ projectId: pid, assetNumber: "CST-000246", name: "Blue Jeans", category: "CLOTHING", type: "Jeans", color: "Blue", brand: "Levi's", size: "32", source: "PURCHASED", purchaseCost: 4200, characterId: raj.id, status: "ON_SET", location: "Set" });
  const shoes = await mk({ projectId: pid, assetNumber: "CST-000248", name: "Brown Leather Shoes", category: "FOOTWEAR", type: "Shoes", color: "Brown", brand: "Clarks", size: "10", source: "PURCHASED", purchaseCost: 6500, characterId: raj.id, status: "ON_SET", location: "Set" });
  const watch = await mk({ projectId: pid, assetNumber: "CST-000249", name: "Steel Watch", category: "ACCESSORY", type: "Watch", color: "Silver", brand: "Titan", source: "ACTORS_OWN", characterId: raj.id, status: "ON_SET", location: "Set" });
  const belt = await mk({ projectId: pid, assetNumber: "CST-000250", name: "Brown Belt", category: "ACCESSORY", type: "Belt", color: "Brown", size: "34", source: "STOCK", characterId: raj.id, status: "ON_SET", location: "Set" });
  const navyBlazer = await mk({ projectId: pid, assetNumber: "CST-000252", name: "Navy Blazer", category: "CLOTHING", type: "Jacket", color: "Navy", brand: "Raymond", size: "40", source: "PURCHASED", purchaseCost: 12500, characterId: raj.id, status: "AVAILABLE", location: "Wardrobe Truck" });
  const bloodShirt = await mk({ projectId: pid, assetNumber: "CST-000253", name: "White Shirt (blood-stained, Sc 32)", category: "CLOTHING", type: "Shirt", color: "White", brand: "Zara", size: "L", source: "PURCHASED", purchaseCost: 3500, characterId: raj.id, status: "AVAILABLE", location: "Warehouse", notes: "Pre-distressed for Scene 32. DO NOT CLEAN." });

  const redDress = await mk({ projectId: pid, assetNumber: "CST-000301", name: "Red Cocktail Dress", category: "CLOTHING", type: "Dress", color: "Red", brand: "Designer - Anita", size: "S", source: "CUSTOM_MADE", purchaseCost: 18000, characterId: priya.id, status: "ISSUED", location: "Vanity Van 2" });
  const heels = await mk({ projectId: pid, assetNumber: "CST-000302", name: "Black Heels", category: "FOOTWEAR", type: "Heels", color: "Black", brand: "Steve Madden", size: "6", source: "PURCHASED", purchaseCost: 5500, characterId: priya.id, status: "ISSUED", location: "Vanity Van 2" });
  const handbag = await mk({ projectId: pid, assetNumber: "CST-000303", name: "Black Clutch", category: "ACCESSORY", type: "Bag", color: "Black", source: "BORROWED", characterId: priya.id, status: "ISSUED", location: "Vanity Van 2" });
  const earrings = await mk({ projectId: pid, assetNumber: "CST-000304", name: "Gold Statement Earrings", category: "JEWELLERY", type: "Earrings", color: "Gold", source: "RENTED", rentalCostPerDay: 800, vendorId: xyz.id, characterId: priya.id, status: "ISSUED", location: "Vanity Van 2" });
  const yellowKurta = await mk({ projectId: pid, assetNumber: "CST-000305", name: "Yellow Kurta Set", category: "CLOTHING", type: "Kurta", color: "Yellow", size: "S", source: "PURCHASED", purchaseCost: 4800, characterId: priya.id, status: "AVAILABLE", location: "Wardrobe Truck" });

  const uniform = await mk({ projectId: pid, assetNumber: "CST-000401", name: "Police Uniform (Khaki)", category: "CLOTHING", type: "Uniform", color: "Khaki", size: "44", source: "RENTED", rentalCostPerDay: 1200, vendorId: xyz.id, characterId: inspector.id, status: "ALTERATION", location: "Tailor" });
  const cap = await mk({ projectId: pid, assetNumber: "CST-000402", name: "Police Cap", category: "ACCESSORY", type: "Hat", color: "Khaki", source: "RENTED", rentalCostPerDay: 200, vendorId: xyz.id, characterId: inspector.id, status: "AVAILABLE", location: "Wardrobe Truck" });
  const waiterVest = await mk({ projectId: pid, assetNumber: "CST-000501", name: "Waiter Vest & Bow Tie", category: "CLOTHING", type: "Uniform", color: "Black", size: "38", source: "STOCK", characterId: waiter.id, status: "MISSING", location: "Unknown" });
  const waiterShirt = await mk({ projectId: pid, assetNumber: "CST-000502", name: "White Waiter Shirt", category: "CLOTHING", type: "Shirt", color: "White", size: "M", source: "STOCK", characterId: waiter.id, status: "AVAILABLE", location: "Wardrobe Truck" });
  const sherwani = await mk({ projectId: pid, assetNumber: "SH-234", name: "Ivory Sherwani (wedding)", category: "CLOTHING", type: "Sherwani", color: "Ivory", size: "40", source: "RENTED", rentalCostPerDay: 2500, vendorId: xyz.id, characterId: raj.id, status: "AVAILABLE", location: "Warehouse" });
  const saree = await mk({ projectId: pid, assetNumber: "CST-000601", name: "Cream Silk Saree", category: "CLOTHING", type: "Saree", color: "Cream", source: "PURCHASED", purchaseCost: 9500, characterId: mother.id, status: "DAMAGED", location: "Wardrobe Truck" });
  const spareBlackShoes = await mk({ projectId: pid, assetNumber: "CST-000701", name: "Black Formal Shoes", category: "FOOTWEAR", type: "Shoes", color: "Black", size: "9", source: "STOCK", status: "AVAILABLE", location: "Warehouse B" });

  const all = [whiteShirt, whiteShirt2, whiteShirt3, jeans, shoes, watch, belt, navyBlazer, bloodShirt, redDress, heels, handbag, earrings, yellowKurta, uniform, cap, waiterVest, waiterShirt, sherwani, saree, spareBlackShoes];
  for (const c of all) {
    await prisma.costumeMovement.create({ data: { costumeId: c.id, action: "RECEIVED", toLocation: "Warehouse", toStatus: "AVAILABLE", byUserId: users.WARDROBE_ASSISTANT.id, byUserName: users.WARDROBE_ASSISTANT.name, note: "Received into inventory", createdAt: at(10, 0, -3) } });
  }

  // Changes (looks)
  const rajLook12 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: raj.id, changeNumber: 12, name: "Restaurant - white shirt & jeans", description: "Sleeves rolled, top button open, watch on left wrist.", items: { create: [{ costumeId: whiteShirt.id, wearNotes: "Sleeves rolled, top button open" }, { costumeId: jeans.id }, { costumeId: shoes.id }, { costumeId: watch.id, wearNotes: "Left wrist" }, { costumeId: belt.id }] } } });
  const rajLook13 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: raj.id, changeNumber: 13, name: "Office - navy blazer", items: { create: [{ costumeId: navyBlazer.id }, { costumeId: whiteShirt2.id }, { costumeId: jeans.id }, { costumeId: shoes.id }] } } });
  const rajLook15 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: raj.id, changeNumber: 15, name: "Sc 32 - blood-stained shirt", description: "Continuity from Sc 31 fight. Pre-distressed duplicate.", items: { create: [{ costumeId: bloodShirt.id }, { costumeId: jeans.id }, { costumeId: shoes.id }] } } });
  const rajLook20 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: raj.id, changeNumber: 20, name: "Wedding - ivory sherwani", items: { create: [{ costumeId: sherwani.id }] } } });
  const priyaLook7 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: priya.id, changeNumber: 7, name: "Restaurant - red dress", description: "Hair down, statement earrings.", items: { create: [{ costumeId: redDress.id }, { costumeId: heels.id }, { costumeId: handbag.id }, { costumeId: earrings.id }] } } });
  const priyaLook8 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: priya.id, changeNumber: 8, name: "Newsroom - yellow kurta", items: { create: [{ costumeId: yellowKurta.id }] } } });
  const inspLook1 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: inspector.id, changeNumber: 1, name: "Uniform", items: { create: [{ costumeId: uniform.id }, { costumeId: cap.id }] } } });
  const waiterLook1 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: waiter.id, changeNumber: 1, name: "Restaurant uniform", items: { create: [{ costumeId: waiterVest.id }, { costumeId: waiterShirt.id }] } } });
  const motherLook1 = await prisma.costumeChange.create({ data: { projectId: pid, characterId: mother.id, changeNumber: 1, name: "Cream saree", items: { create: [{ costumeId: saree.id }] } } });

  // Scenes
  const scenesData = [
    { number: "12", name: "Raj's office - morning", location: "Office Set", intExt: "INT", timeOfDay: "DAY", scriptDay: "Day 1", status: "SHOT", shootDate: dayOnly(-6), chars: [[raj.id, rajLook13.id]] },
    { number: "15", name: "Newsroom", location: "Newsroom Set", intExt: "INT", timeOfDay: "DAY", scriptDay: "Day 1", status: "SHOT", shootDate: dayOnly(-5), chars: [[priya.id, priyaLook8.id]] },
    { number: "18", name: "Street outside cafe", location: "Bandra", intExt: "EXT", timeOfDay: "DAY", scriptDay: "Day 2", status: "SHOT", shootDate: dayOnly(-2), chars: [[raj.id, rajLook13.id], [priya.id, priyaLook8.id]] },
    { number: "24", name: "Restaurant - the dinner", location: "Restaurant Set, Stage 2", intExt: "INT", timeOfDay: "NIGHT", scriptDay: "Day 3", status: "SHOOTING", shootDate: dayOnly(0), pages: "3 2/8", synopsis: "Raj and Priya's first dinner. Inspector Pandey interrupts.", chars: [[raj.id, rajLook12.id], [priya.id, priyaLook7.id], [inspector.id, inspLook1.id], [waiter.id, waiterLook1.id]] },
    { number: "25", name: "Restaurant - parking lot", location: "Backlot", intExt: "EXT", timeOfDay: "NIGHT", scriptDay: "Day 3", status: "SCHEDULED", shootDate: dayOnly(0), pages: "1 1/8", chars: [[raj.id, rajLook12.id], [priya.id, priyaLook7.id]] },
    { number: "26", name: "Raj's home - late night", location: "Home Set, Stage 1", intExt: "INT", timeOfDay: "NIGHT", scriptDay: "Day 3", status: "SCHEDULED", shootDate: dayOnly(0), pages: "2", chars: [[raj.id, rajLook12.id], [mother.id, motherLook1.id]] },
    { number: "27", name: "Police station", location: "Police Station Set", intExt: "INT", timeOfDay: "DAY", scriptDay: "Day 4", status: "SCHEDULED", shootDate: dayOnly(1), chars: [[raj.id, rajLook13.id], [inspector.id, inspLook1.id]] },
    { number: "28", name: "Raj's home - morning after", location: "Home Set, Stage 1", intExt: "INT", timeOfDay: "DAY", scriptDay: "Day 4", status: "SCHEDULED", shootDate: dayOnly(1), chars: [[raj.id, rajLook12.id]] },
    { number: "31", name: "Alley fight", location: "Dharavi location", intExt: "EXT", timeOfDay: "NIGHT", scriptDay: "Day 5", status: "PLANNED", shootDate: dayOnly(3), chars: [[raj.id, rajLook12.id]] },
    { number: "32", name: "Hospital corridor", location: "Hospital location", intExt: "INT", timeOfDay: "NIGHT", scriptDay: "Day 5", status: "PLANNED", shootDate: dayOnly(3), synopsis: "Raj wears the blood-stained white shirt from Sc 31.", chars: [[raj.id, rajLook15.id], [priya.id, null]] },
    { number: "40", name: "Wedding", location: "Palace, Jaipur", intExt: "EXT", timeOfDay: "DAY", scriptDay: "Day 9", status: "PLANNED", shootDate: dayOnly(12), chars: [[raj.id, rajLook20.id], [priya.id, null], [mother.id, motherLook1.id]] },
  ];
  const scenes: Record<string, { id: string }> = {};
  for (const s of scenesData) {
    const { chars, ...rest } = s;
    const scene = await prisma.scene.create({ data: { ...rest, projectId: pid, sortOrder: Number(rest.number) * 100 } });
    scenes[rest.number] = scene;
    for (const [characterId, changeId] of chars) {
      await prisma.sceneCharacter.create({ data: { sceneId: scene.id, characterId: characterId as string, changeId: (changeId as string | null) || null } });
    }
  }

  // Today's movements for the dashboard (issue / to set)
  const issued = [whiteShirt, jeans, shoes, watch, belt, redDress, heels, handbag, earrings];
  for (const c of issued) {
    await prisma.costumeMovement.create({ data: { costumeId: c.id, action: "ISSUE", fromLocation: "Wardrobe Truck", toLocation: "Actor", fromStatus: "AVAILABLE", toStatus: "ISSUED", byUserId: users.WARDROBE_ASSISTANT.id, byUserName: users.WARDROBE_ASSISTANT.name, sceneId: scenes["24"].id, createdAt: at(8, 30) } });
  }
  for (const c of [whiteShirt, jeans, shoes, watch, belt]) {
    await prisma.costumeMovement.create({ data: { costumeId: c.id, action: "TO_SET", fromLocation: "Actor", toLocation: "Set", fromStatus: "ISSUED", toStatus: "ON_SET", byUserId: users.DRESSER.id, byUserName: users.DRESSER.name, sceneId: scenes["24"].id, createdAt: at(9, 45) } });
  }
  await prisma.costumeMovement.create({ data: { costumeId: yellowKurta.id, action: "RETURN", fromLocation: "Actor", toLocation: "Wardrobe Truck", fromStatus: "ISSUED", toStatus: "AVAILABLE", byUserId: users.WARDROBE_ASSISTANT.id, byUserName: users.WARDROBE_ASSISTANT.name, createdAt: at(7, 50) } });
  await prisma.costumeMovement.create({ data: { costumeId: navyBlazer.id, action: "RETURN", fromLocation: "Actor", toLocation: "Wardrobe Truck", fromStatus: "ISSUED", toStatus: "AVAILABLE", byUserId: users.WARDROBE_ASSISTANT.id, byUserName: users.WARDROBE_ASSISTANT.name, createdAt: at(7, 55) } });

  // Cleaning: one completed earlier today, one in progress
  await prisma.cleaningRequest.create({
    data: {
      projectId: pid, costumeId: whiteShirt2.id, sceneId: scenes["18"].id, takeNumber: 2, problem: "Sweat marks under arms", cleaningType: "SWEAT_TREATMENT", priority: "NORMAL", status: "READY",
      requestedById: users.WARDROBE_ASSISTANT.id, requestedByName: users.WARDROBE_ASSISTANT.name, assignedToId: users.LAUNDRY.id, assignedToName: users.LAUNDRY.name,
      startedAt: at(7, 10), completedAt: at(8, 5), qcResult: "PASS", expectedReadyAt: at(8, 10), createdAt: at(7, 0),
      logs: { create: [
        { toStatus: "REQUESTED", byUserName: users.WARDROBE_ASSISTANT.name, createdAt: at(7, 0) },
        { fromStatus: "REQUESTED", toStatus: "RECEIVED", byUserName: users.LAUNDRY.name, createdAt: at(7, 5) },
        { fromStatus: "RECEIVED", toStatus: "CLEANING", byUserName: users.LAUNDRY.name, createdAt: at(7, 10) },
        { fromStatus: "CLEANING", toStatus: "DRYING", byUserName: users.LAUNDRY.name, createdAt: at(7, 40) },
        { fromStatus: "DRYING", toStatus: "IRONING", byUserName: users.LAUNDRY.name, createdAt: at(7, 55) },
        { fromStatus: "IRONING", toStatus: "QUALITY_CHECK", byUserName: users.LAUNDRY.name, createdAt: at(8, 0) },
        { fromStatus: "QUALITY_CHECK", toStatus: "READY", byUserName: users.COSTUME_SUPERVISOR.name, note: "QC pass", createdAt: at(8, 5) },
      ] },
    },
  });
  const cleaningSaree = await prisma.costume.update({ where: { id: yellowKurta.id }, data: { status: "CLEANING", location: "Laundry" } });
  await prisma.cleaningRequest.create({
    data: {
      projectId: pid, costumeId: cleaningSaree.id, sceneId: scenes["18"].id, takeNumber: 5, problem: "Mud on hem from street scene", cleaningType: "MUD_CLEANING", priority: "HIGH", status: "CLEANING",
      requestedById: users.WARDROBE_ASSISTANT.id, requestedByName: users.WARDROBE_ASSISTANT.name, assignedToId: users.LAUNDRY.id, assignedToName: users.LAUNDRY.name,
      startedAt: at(9, 0), expectedReadyAt: at(11, 30), createdAt: at(8, 20),
      logs: { create: [
        { toStatus: "REQUESTED", byUserName: users.WARDROBE_ASSISTANT.name, createdAt: at(8, 20) },
        { fromStatus: "REQUESTED", toStatus: "RECEIVED", byUserName: users.LAUNDRY.name, createdAt: at(8, 40) },
        { fromStatus: "RECEIVED", toStatus: "CLEANING", byUserName: users.LAUNDRY.name, createdAt: at(9, 0) },
      ] },
    },
  });
  await prisma.costumeMovement.create({ data: { costumeId: yellowKurta.id, action: "CLEANING_REQUESTED", fromLocation: "Wardrobe Truck", toLocation: "Laundry", fromStatus: "AVAILABLE", toStatus: "CLEANING", byUserName: users.WARDROBE_ASSISTANT.name, byUserId: users.WARDROBE_ASSISTANT.id, note: "MUD_CLEANING: Mud on hem", createdAt: at(8, 20) } });

  // Alteration (Inspector uniform)
  await prisma.alterationRequest.create({ data: { projectId: pid, costumeId: uniform.id, characterId: inspector.id, issue: "Sleeves too long", required: "Reduce 1.5 inch", tailorName: "Ramesh", assignedToId: users.TAILOR.id, priority: "HIGH", deadline: at(17, 0), status: "IN_PROGRESS", createdAt: at(10, 15) } });
  await prisma.costumeMovement.create({ data: { costumeId: uniform.id, action: "ALTERATION_REQUESTED", fromLocation: "Wardrobe Truck", toLocation: "Tailor", fromStatus: "AVAILABLE", toStatus: "ALTERATION", byUserName: users.COSTUME_SUPERVISOR.name, byUserId: users.COSTUME_SUPERVISOR.id, note: "Sleeves too long → reduce 1.5 inch", createdAt: at(10, 15) } });

  // Damage (saree) & missing (waiter vest)
  await prisma.damageReport.create({ data: { projectId: pid, costumeId: saree.id, sceneId: scenes["18"].id, takeNumber: 3, description: "Torn pallu edge (caught on door)", estimatedRepairCost: 800, responsible: "PRODUCTION", status: "OPEN", createdAt: at(11, 0, -2) } });
  await prisma.costumeMovement.create({ data: { costumeId: saree.id, action: "MARK_DAMAGED", fromLocation: "Set", toLocation: "Wardrobe Truck", fromStatus: "ON_SET", toStatus: "DAMAGED", byUserName: users.DRESSER.name, note: "Torn pallu edge", createdAt: at(11, 0, -2) } });
  await prisma.missingItem.create({ data: { projectId: pid, costumeId: waiterVest.id, lastSeenLocation: "Set B", lastAssignedTo: users.WARDROBE_ASSISTANT.name, lastScanAt: at(16, 22, -1), status: "OPEN", notes: "Not returned after wrap yesterday." } });
  await prisma.costumeMovement.create({ data: { costumeId: waiterVest.id, action: "MARK_MISSING", fromLocation: "Set B", toLocation: "Unknown", fromStatus: "ISSUED", toStatus: "MISSING", byUserName: users.WARDROBE_ASSISTANT.name, note: "Not returned after wrap", createdAt: at(18, 30, -1) } });

  // Fittings
  await prisma.fitting.create({ data: { projectId: pid, characterId: raj.id, actorId: arjun.id, scheduledAt: at(10, 0, 3), location: "Wardrobe Truck", status: "SCHEDULED", notes: "Sherwani fitting for Sc 40 + blazer check", items: { create: [{ costumeId: sherwani.id, status: "PENDING" }, { costumeId: navyBlazer.id, status: "PENDING" }] } } });
  await prisma.fitting.create({ data: { projectId: pid, characterId: raj.id, actorId: arjun.id, scheduledAt: at(15, 0, -4), location: "Wardrobe Truck", status: "COMPLETED", items: { create: [{ costumeId: whiteShirt.id, status: "FITTED" }, { costumeId: jeans.id, status: "FITTED" }, { costumeId: shoes.id, status: "FITTED", notes: "Half size big, insole added" }] } } });
  await prisma.fitting.create({ data: { projectId: pid, characterId: inspector.id, actorId: vikram.id, scheduledAt: at(14, 0), location: "Vanity Van 1", status: "IN_PROGRESS", items: { create: [{ costumeId: uniform.id, status: "ALTERATION_REQUIRED", notes: "Sleeves too long" }, { costumeId: cap.id, status: "FITTED" }] } } });

  // Continuity for Scene 24 (Raj) takes 1-3
  for (const take of [1, 2, 3]) {
    await prisma.continuityRecord.create({
      data: {
        projectId: pid, sceneId: scenes["24"].id, characterId: raj.id, changeId: rajLook12.id, takeNumber: take,
        details: JSON.stringify({ Shirt: "Top button open", Sleeves: "Rolled twice", Hair: "Normal", Jeans: "Cuffed once" }),
        accessories: JSON.stringify([{ name: "Watch", present: true }, { name: "Belt", present: true }, { name: "Ring", present: take !== 3 }]),
        notes: take === 3 ? "Coffee spill on shirt at end of take" : null,
        recordedById: users.CONTINUITY.id, recordedByName: users.CONTINUITY.name, createdAt: at(10 + take, 15),
      },
    });
  }
  await prisma.continuityRecord.create({ data: { projectId: pid, sceneId: scenes["24"].id, characterId: priya.id, changeId: priyaLook7.id, takeNumber: 1, details: JSON.stringify({ Hair: "Down", Dress: "Strap adjusted", Lipstick: "Red" }), accessories: JSON.stringify([{ name: "Earrings", present: true }, { name: "Clutch", present: true }]), recordedById: users.CONTINUITY.id, recordedByName: users.CONTINUITY.name } });

  // Rentals
  await prisma.rental.create({ data: { projectId: pid, costumeId: sherwani.id, vendorId: xyz.id, ratePerDay: 2500, pickupDate: dayOnly(-1), returnDate: dayOnly(1), status: "PICKED_UP", notes: "Reminder before return." } });
  await prisma.rental.create({ data: { projectId: pid, costumeId: uniform.id, vendorId: xyz.id, ratePerDay: 1200, pickupDate: dayOnly(-10), returnDate: dayOnly(20), status: "PICKED_UP" } });
  await prisma.rental.create({ data: { projectId: pid, costumeId: earrings.id, vendorId: xyz.id, ratePerDay: 800, pickupDate: dayOnly(-3), returnDate: dayOnly(4), status: "PICKED_UP" } });

  // Expenses (matches blueprint budget)
  const expenses = [
    ["PURCHASE", 250000, "Costume purchases (prep)"],
    ["RENTAL", 120000, "Rentals - XYZ Costumes (prep block)"],
    ["LAUNDRY", 35000, "Laundry & dry cleaning to date"],
    ["TAILORING", 45000, "Tailoring & alterations to date"],
    ["ACCESSORIES", 75000, "Accessories & jewellery"],
    ["DAMAGE", 15000, "Damage repairs to date"],
  ] as const;
  for (const [category, amount, description] of expenses) {
    await prisma.expense.create({ data: { projectId: pid, category, amount, description, date: dayOnly(-7), characterId: category === "ACCESSORIES" ? priya.id : category === "PURCHASE" ? raj.id : null } });
  }
  await prisma.expense.create({ data: { projectId: pid, category: "PURCHASE", amount: 3500, description: "Purchase CST-000245 White Formal Shirt", costumeId: whiteShirt.id, characterId: raj.id, vendorId: zara.id, date: dayOnly(-12) } });
  await prisma.expense.create({ data: { projectId: pid, category: "TAILORING", amount: 1200, description: "Uniform sleeve alteration - Ramesh", costumeId: uniform.id, characterId: inspector.id, sceneId: scenes["24"].id, date: dayOnly(0) } });

  // Notifications
  const notifyAll = async (type: string, severity: string, title: string, body: string, entityType?: string, entityId?: string) => {
    for (const u of Object.values(users)) await prisma.notification.create({ data: { projectId: pid, userId: u.id, type, severity, title, body, entityType, entityId } });
  };
  await notifyAll("MISSING", "CRITICAL", "Costume missing", "CST-000501 Waiter Vest & Bow Tie has not been returned.", "COSTUME", waiterVest.id);
  await notifyAll("RENTAL", "WARNING", "Rental return due", "Sherwani SH-234 is due back to XYZ Costumes tomorrow.", "COSTUME", sherwani.id);
  await notifyAll("CLEANING", "INFO", "Cleaning completed", "CST-000247 White Formal Shirt (dup 2) is ready for Scene 24.", "COSTUME", whiteShirt2.id);
  await notifyAll("ALTERATION", "WARNING", "Alteration in progress", "CST-000401 Police Uniform: sleeves reduce 1.5 inch, due 5 PM.", "COSTUME", uniform.id);

  await prisma.auditLog.create({ data: { projectId: pid, userId: users.ADMIN.id, userName: users.ADMIN.name, action: "SEED", entityType: "PROJECT", entityId: pid } });

  console.log("Seeded demo project 'Movie ABC'.");
  console.log("Login: admin@sinkonset.app / password123 (all demo users share this password)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
