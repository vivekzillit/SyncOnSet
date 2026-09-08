// Single source of truth for all "enum-like" string values.
// Kept as plain strings so the schema is portable across SQLite and PostgreSQL.

export const ROLES = [
  "ADMIN",
  "PRODUCTION_MANAGER",
  "COSTUME_DESIGNER",
  "COSTUME_SUPERVISOR",
  "COSTUME_ASSISTANT",
  "WARDROBE_ASSISTANT",
  "DRESSER",
  "TAILOR",
  "LAUNDRY",
  "CONTINUITY",
  "ACTOR",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to see money (budgets, purchase costs, expenses). */
export const FINANCE_ROLES: Role[] = ["ADMIN", "PRODUCTION_MANAGER", "COSTUME_DESIGNER", "COSTUME_SUPERVISOR"];
/** Roles allowed to manage project structure (scenes, characters, changes, users). */
export const MANAGER_ROLES: Role[] = ["ADMIN", "PRODUCTION_MANAGER", "COSTUME_DESIGNER", "COSTUME_SUPERVISOR"];
/** Roles allowed to do day-to-day wardrobe operations. */
export const OPS_ROLES: Role[] = [...MANAGER_ROLES, "COSTUME_ASSISTANT", "WARDROBE_ASSISTANT", "DRESSER"];
/** Roles allowed to work cleaning tickets. */
export const CLEANING_ROLES: Role[] = [...OPS_ROLES, "LAUNDRY"];
/** Roles allowed to work alteration tickets. */
export const TAILOR_ROLES: Role[] = [...OPS_ROLES, "TAILOR"];
/** Roles allowed to write continuity records. */
export const CONTINUITY_ROLES: Role[] = [...OPS_ROLES, "CONTINUITY"];

export const PROJECT_STATUSES = ["PREP", "SHOOTING", "WRAP", "ARCHIVED"] as const;
export const CHARACTER_TYPES = ["LEAD", "SUPPORTING", "DAY_PLAYER", "BACKGROUND"] as const;
export const SCENE_STATUSES = ["PLANNED", "SCHEDULED", "SHOOTING", "SHOT", "OMITTED"] as const;
export const INT_EXT = ["INT", "EXT", "INT/EXT"] as const;
export const TIMES_OF_DAY = ["DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS"] as const;

export const COSTUME_CATEGORIES = ["CLOTHING", "ACCESSORY", "FOOTWEAR", "JEWELLERY", "PROP"] as const;
export const COSTUME_TYPES: Record<(typeof COSTUME_CATEGORIES)[number], string[]> = {
  CLOTHING: ["Shirt", "T-Shirt", "Trousers", "Jeans", "Jacket", "Suit", "Dress", "Saree", "Kurta", "Sherwani", "Skirt", "Blouse", "Coat", "Uniform", "Innerwear", "Other"],
  ACCESSORY: ["Watch", "Belt", "Bag", "Sunglasses", "Hat", "Scarf", "Tie", "Gloves", "Other"],
  FOOTWEAR: ["Shoes", "Heels", "Boots", "Sandals", "Sneakers", "Other"],
  JEWELLERY: ["Ring", "Necklace", "Earrings", "Bracelet", "Bangles", "Other"],
  PROP: ["Other"],
};

export const COSTUME_SOURCES = ["PURCHASED", "RENTED", "BORROWED", "STOCK", "CUSTOM_MADE", "DESIGNER", "ACTORS_OWN"] as const;

export const COSTUME_STATUSES = [
  "AVAILABLE",
  "ISSUED",
  "ON_SET",
  "CLEANING",
  "ALTERATION",
  "DAMAGED",
  "MISSING",
  "RETURNED_TO_VENDOR",
  "RETIRED",
] as const;
export type CostumeStatus = (typeof COSTUME_STATUSES)[number];

export const STANDARD_LOCATIONS = ["Warehouse", "Wardrobe Truck", "Wardrobe Van", "Vanity Van", "Actor", "Set", "Laundry", "Tailor", "Vendor"] as const;

export const MOVEMENT_ACTIONS = [
  "RECEIVED",
  "ISSUE",
  "RETURN",
  "MOVE",
  "TO_SET",
  "CLEANING_REQUESTED",
  "CLEANING_COMPLETE",
  "ALTERATION_REQUESTED",
  "ALTERATION_COMPLETE",
  "MARK_DAMAGED",
  "REPAIRED",
  "MARK_MISSING",
  "FOUND",
  "RETURN_TO_VENDOR",
  "RETIRE",
  "STATUS_CHANGE",
  "SCAN",
] as const;
export type MovementAction = (typeof MOVEMENT_ACTIONS)[number];

export const CLEANING_TYPES = [
  "SPOT_CLEANING",
  "HAND_WASH",
  "MACHINE_WASH",
  "DRY_CLEANING",
  "STEAM",
  "IRONING",
  "STAIN_REMOVAL",
  "BLOOD_REMOVAL",
  "SWEAT_TREATMENT",
  "MAKEUP_REMOVAL",
  "MUD_CLEANING",
  "FOOD_STAIN_REMOVAL",
  "SPECIAL_FABRIC",
] as const;

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

/** Ordered cleaning pipeline. `advance` moves to the next stage. */
export const CLEANING_PIPELINE = ["REQUESTED", "RECEIVED", "CLEANING", "DRYING", "IRONING", "QUALITY_CHECK", "READY"] as const;
export const CLEANING_STATUSES = [...CLEANING_PIPELINE, "CANCELLED"] as const;
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];

export const FITTING_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const FITTING_ITEM_STATUSES = ["PENDING", "FITTED", "ALTERATION_REQUIRED", "REJECTED"] as const;

export const ALTERATION_PIPELINE = ["REQUESTED", "ASSIGNED", "IN_PROGRESS", "QUALITY_CHECK", "COMPLETED"] as const;
export const ALTERATION_STATUSES = [...ALTERATION_PIPELINE, "CANCELLED"] as const;

export const DAMAGE_STATUSES = ["OPEN", "REPAIRING", "REPAIRED", "WRITTEN_OFF"] as const;
export const DAMAGE_RESPONSIBLE = ["PRODUCTION", "ACTOR", "VENDOR", "UNKNOWN"] as const;
export const MISSING_STATUSES = ["OPEN", "FOUND", "WRITTEN_OFF"] as const;
export const RENTAL_STATUSES = ["BOOKED", "PICKED_UP", "RETURNED", "OVERDUE"] as const;
export const EXPENSE_CATEGORIES = ["PURCHASE", "RENTAL", "LAUNDRY", "TAILORING", "ACCESSORIES", "DAMAGE", "OTHER"] as const;

export const PHOTO_ENTITY_TYPES = ["COSTUME", "CHANGE", "FITTING", "CONTINUITY", "CLEANING", "DAMAGE", "CHARACTER", "ACTOR"] as const;
export const PHOTO_KINDS = ["FRONT", "SIDE", "BACK", "CLOSEUP", "DETAIL", "STAIN", "OTHER"] as const;

export const NOTIFICATION_TYPES = ["CLEANING", "MISSING", "RENTAL", "ALTERATION", "DAMAGE", "READINESS", "FITTING", "GENERAL"] as const;

export const META = {
  roles: ROLES,
  financeRoles: FINANCE_ROLES,
  managerRoles: MANAGER_ROLES,
  opsRoles: OPS_ROLES,
  projectStatuses: PROJECT_STATUSES,
  characterTypes: CHARACTER_TYPES,
  sceneStatuses: SCENE_STATUSES,
  intExt: INT_EXT,
  timesOfDay: TIMES_OF_DAY,
  costumeCategories: COSTUME_CATEGORIES,
  costumeTypes: COSTUME_TYPES,
  costumeSources: COSTUME_SOURCES,
  costumeStatuses: COSTUME_STATUSES,
  standardLocations: STANDARD_LOCATIONS,
  movementActions: MOVEMENT_ACTIONS,
  cleaningTypes: CLEANING_TYPES,
  cleaningPipeline: CLEANING_PIPELINE,
  cleaningStatuses: CLEANING_STATUSES,
  priorities: PRIORITIES,
  fittingStatuses: FITTING_STATUSES,
  fittingItemStatuses: FITTING_ITEM_STATUSES,
  alterationPipeline: ALTERATION_PIPELINE,
  alterationStatuses: ALTERATION_STATUSES,
  damageStatuses: DAMAGE_STATUSES,
  damageResponsible: DAMAGE_RESPONSIBLE,
  missingStatuses: MISSING_STATUSES,
  rentalStatuses: RENTAL_STATUSES,
  expenseCategories: EXPENSE_CATEGORIES,
  photoEntityTypes: PHOTO_ENTITY_TYPES,
  photoKinds: PHOTO_KINDS,
  notificationTypes: NOTIFICATION_TYPES,
};
