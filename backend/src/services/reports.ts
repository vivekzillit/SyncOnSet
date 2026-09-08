import { prisma } from "../lib/prisma";

function dayRange(dateStr?: string) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function dashboard(projectId: string, dateStr?: string) {
  const { start, end } = dayRange(dateStr);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const [
    characters,
    costumes,
    todaysScenes,
    statusGroups,
    cleaningOpen,
    alterationOpen,
    missingOpen,
    damagedOpen,
    issuedToday,
    returnedToday,
    emergenciesToday,
    fittingsToday,
    rentalsDue,
  ] = await Promise.all([
    prisma.character.count({ where: { projectId } }),
    prisma.costume.count({ where: { projectId, isRetired: false } }),
    prisma.scene.findMany({
      where: { projectId, shootDate: { gte: start, lt: end } },
      orderBy: { sortOrder: "asc" },
      include: { characters: { include: { character: { select: { id: true, name: true } }, change: { include: { items: { include: { costume: { select: { status: true } } } } } } } } },
    }),
    prisma.costume.groupBy({ by: ["status"], where: { projectId, isRetired: false }, _count: { _all: true } }),
    prisma.cleaningRequest.count({ where: { projectId, status: { notIn: ["READY", "CANCELLED"] } } }),
    prisma.alterationRequest.count({ where: { projectId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.missingItem.count({ where: { projectId, status: "OPEN" } }),
    prisma.damageReport.count({ where: { projectId, status: { in: ["OPEN", "REPAIRING"] } } }),
    prisma.costumeMovement.count({ where: { costume: { projectId }, action: "ISSUE", createdAt: { gte: start, lt: end } } }),
    prisma.costumeMovement.count({ where: { costume: { projectId }, action: "RETURN", createdAt: { gte: start, lt: end } } }),
    prisma.cleaningRequest.count({ where: { projectId, isEmergency: true, createdAt: { gte: start, lt: end } } }),
    prisma.fitting.count({ where: { projectId, scheduledAt: { gte: start, lt: end }, status: { not: "CANCELLED" } } }),
    prisma.rental.count({ where: { projectId, status: { in: ["BOOKED", "PICKED_UP"] }, returnDate: { lt: new Date(end.getTime() + 24 * 60 * 60 * 1000) } } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) byStatus[g.status] = g._count._all;

  // Costumes needed today = distinct costumes across changes assigned to today's scenes
  const todayCostumeIds = new Set<string>();
  const SEVERITY = ["MISSING", "DAMAGED", "ALTERATION", "CLEANING", "NOT_ASSIGNED", "READY"];
  const worst = (a: string, b: string) => (SEVERITY.indexOf(a) < SEVERITY.indexOf(b) ? a : b);
  const sceneSummaries = todaysScenes.map((s) => {
    let level = s.characters.length ? "READY" : "NOT_ASSIGNED";
    const chars = s.characters.map((sc) => {
      const statuses = sc.change?.items.map((i) => i.costume.status) || [];
      sc.change?.items.forEach((i) => todayCostumeIds.add(i.costumeId));
      let lvl = sc.change ? "READY" : "NOT_ASSIGNED";
      if (statuses.includes("MISSING")) lvl = "MISSING";
      else if (statuses.includes("DAMAGED")) lvl = "DAMAGED";
      else if (statuses.includes("ALTERATION")) lvl = "ALTERATION";
      else if (statuses.includes("CLEANING")) lvl = "CLEANING";
      level = worst(level, lvl);
      return { characterId: sc.character.id, name: sc.character.name, change: sc.change ? `#${sc.change.changeNumber} ${sc.change.name}` : null, level: lvl };
    });
    return { id: s.id, number: s.number, name: s.name, location: s.location, timeOfDay: s.timeOfDay, status: s.status, level, characters: chars };
  });

  const priorities: { severity: "CRITICAL" | "WARNING" | "INFO" | "OK"; text: string; link: string }[] = [];
  if (missingOpen) priorities.push({ severity: "CRITICAL", text: `${missingOpen} costume${missingOpen > 1 ? "s" : ""} missing`, link: "missing" });
  if (damagedOpen) priorities.push({ severity: "CRITICAL", text: `${damagedOpen} damage report${damagedOpen > 1 ? "s" : ""} open`, link: "damages" });
  if (alterationOpen) priorities.push({ severity: "WARNING", text: `${alterationOpen} costume${alterationOpen > 1 ? "s" : ""} require alteration`, link: "alterations" });
  if (cleaningOpen) priorities.push({ severity: "INFO", text: `${cleaningOpen} costume${cleaningOpen > 1 ? "s" : ""} in cleaning`, link: "cleaning" });
  if (rentalsDue) priorities.push({ severity: "WARNING", text: `${rentalsDue} rental${rentalsDue > 1 ? "s" : ""} due for return by tomorrow`, link: "vendors" });
  if (fittingsToday) priorities.push({ severity: "INFO", text: `${fittingsToday} fitting${fittingsToday > 1 ? "s" : ""} scheduled today`, link: "fittings" });
  if (returnedToday) priorities.push({ severity: "OK", text: `${returnedToday} costume${returnedToday > 1 ? "s" : ""} returned today`, link: "costumes" });

  return {
    project,
    date: start,
    counts: {
      characters,
      costumes,
      todaysScenes: todaysScenes.length,
      todaysCostumes: todayCostumeIds.size,
      issuedToday,
      returnedToday,
      cleaning: cleaningOpen,
      alteration: alterationOpen,
      missing: missingOpen,
      damaged: damagedOpen,
      emergenciesToday,
      fittingsToday,
      rentalsDue,
      byStatus,
    },
    priorities,
    todaysScenes: sceneSummaries,
  };
}

export async function dailyReport(projectId: string, dateStr?: string) {
  const { start, end } = dayRange(dateStr);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const [scenes, movements, cleaning, alterations, damages, missing, expenses] = await Promise.all([
    prisma.scene.findMany({ where: { projectId, shootDate: { gte: start, lt: end } }, orderBy: { sortOrder: "asc" }, include: { characters: { include: { character: true, change: { include: { items: true } } } } } }),
    prisma.costumeMovement.findMany({ where: { costume: { projectId }, createdAt: { gte: start, lt: end } }, include: { costume: { select: { assetNumber: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.cleaningRequest.findMany({ where: { projectId, createdAt: { gte: start, lt: end } }, include: { costume: { select: { assetNumber: true, name: true } } } }),
    prisma.alterationRequest.findMany({ where: { projectId, OR: [{ createdAt: { gte: start, lt: end } }, { status: { notIn: ["COMPLETED", "CANCELLED"] } }] }, include: { costume: { select: { assetNumber: true, name: true } } } }),
    prisma.damageReport.findMany({ where: { projectId, createdAt: { gte: start, lt: end } }, include: { costume: { select: { assetNumber: true, name: true } } } }),
    prisma.missingItem.findMany({ where: { projectId, status: "OPEN" }, include: { costume: { select: { assetNumber: true, name: true } } } }),
    prisma.expense.findMany({ where: { projectId, date: { gte: start, lt: end } } }),
  ]);
  const costumesUsed = new Set<string>();
  scenes.forEach((s) => s.characters.forEach((sc) => sc.change?.items.forEach((i) => costumesUsed.add(i.costumeId))));
  const count = (a: string) => movements.filter((m) => m.action === a).length;
  return {
    project,
    date: start,
    summary: {
      scenes: scenes.length,
      costumesUsed: costumesUsed.size,
      issued: count("ISSUE"),
      returned: count("RETURN"),
      cleaning: cleaning.length,
      cleaningCompleted: cleaning.filter((c) => c.status === "READY").length,
      emergencyRequests: cleaning.filter((c) => c.isEmergency).length,
      alteration: alterations.length,
      damaged: damages.length,
      missing: missing.length,
      spend: expenses.reduce((s, e) => s + e.amount, 0),
    },
    scenes: scenes.map((s) => ({ id: s.id, number: s.number, name: s.name, location: s.location, status: s.status, characters: s.characters.map((sc) => ({ name: sc.character.name, change: sc.change ? `#${sc.change.changeNumber} ${sc.change.name}` : "—" })) })),
    movements,
    cleaning,
    alterations,
    damages,
    missing,
    expenses,
  };
}

export async function budgetReport(projectId: string) {
  const [expenses, costumes, rentals] = await Promise.all([
    prisma.expense.findMany({ where: { projectId }, include: { character: { select: { name: true } }, scene: { select: { number: true } }, costume: { select: { assetNumber: true, name: true } } }, orderBy: { date: "desc" } }),
    prisma.costume.findMany({ where: { projectId }, select: { id: true, assetNumber: true, name: true, source: true, purchaseCost: true, rentalCostPerDay: true, characterId: true, character: { select: { name: true } } } }),
    prisma.rental.findMany({ where: { projectId }, include: { costume: { select: { assetNumber: true, name: true } }, vendor: { select: { name: true } } } }),
  ]);
  const byCategory: Record<string, number> = {};
  const byCharacter: Record<string, number> = {};
  const byScene: Record<string, number> = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const ch = e.character?.name || "Unassigned";
    byCharacter[ch] = (byCharacter[ch] || 0) + e.amount;
    if (e.scene) byScene[`Scene ${e.scene.number}`] = (byScene[`Scene ${e.scene.number}`] || 0) + e.amount;
  }
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const inventoryValue = costumes.reduce((s, c) => s + (c.purchaseCost || 0), 0);
  const rentalCommitted = rentals.reduce((s, r) => {
    const days = Math.max(1, Math.ceil((r.returnDate.getTime() - r.pickupDate.getTime()) / 86400000));
    return s + days * r.ratePerDay;
  }, 0);
  return { total, byCategory, byCharacter, byScene, inventoryValue, rentalCommitted, expenses, rentals };
}
