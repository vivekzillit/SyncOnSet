export type Role =
  | "ADMIN" | "PRODUCTION_MANAGER" | "COSTUME_DESIGNER" | "COSTUME_SUPERVISOR" | "COSTUME_ASSISTANT"
  | "WARDROBE_ASSISTANT" | "DRESSER" | "TAILOR" | "LAUNDRY" | "CONTINUITY" | "ACTOR";

export interface User { id: string; name: string; email: string; role: Role; phone?: string | null; isActive?: boolean }
export interface ProjectSummary { id: string; name: string; code: string; status: string; role?: Role; myRole?: Role; shootingDay?: number; currentLocation?: string | null; currency?: string; _count?: Record<string, number> }
export interface Project extends ProjectSummary { startDate?: string | null; endDate?: string | null; notes?: string | null; currency: string }

export interface Meta {
  roles: Role[]; financeRoles: Role[]; managerRoles: Role[]; opsRoles: Role[];
  projectStatuses: string[]; characterTypes: string[]; sceneStatuses: string[]; intExt: string[]; timesOfDay: string[];
  costumeCategories: string[]; costumeTypes: Record<string, string[]>; costumeSources: string[]; costumeStatuses: string[];
  standardLocations: string[]; movementActions: string[]; cleaningTypes: string[]; cleaningPipeline: string[]; cleaningStatuses: string[];
  priorities: string[]; fittingStatuses: string[]; fittingItemStatuses: string[]; alterationPipeline: string[]; alterationStatuses: string[];
  damageStatuses: string[]; damageResponsible: string[]; missingStatuses: string[]; rentalStatuses: string[]; expenseCategories: string[];
  photoEntityTypes: string[]; photoKinds: string[]; notificationTypes: string[];
  cueKinds?: string[]; aiEnabled?: boolean; aiModel?: string | null; cuesEnabled?: boolean; cueEngine?: "ai" | "rules";
}

export interface Photo { id: string; entityType: string; entityId: string; kind: string; url: string; caption?: string | null; createdAt: string }
export interface Actor { id: string; name: string; phone?: string | null; email?: string | null; agency?: string | null; measurements: Record<string, string | number>; notes?: string | null; characters?: { id: string; name: string; type?: string }[] }
export interface Character { id: string; name: string; type: string; castNumber?: number | null; age?: number | null; description?: string | null; notes?: string | null; actorId?: string | null; actor?: { id: string; name: string } | null; _count?: { scenes: number; changes: number; costumes: number } }
export interface Costume {
  id: string; assetNumber: string; name: string; category: string; type?: string | null; color?: string | null; brand?: string | null; size?: string | null; fabric?: string | null;
  quantity: number; source: string; purchaseCost?: number | null; rentalCostPerDay?: number | null; vendorId?: string | null; characterId?: string | null;
  status: string; location: string; careInstructions?: string | null; notes?: string | null; isRetired?: boolean; createdAt?: string;
  character?: { id: string; name: string } | null; vendor?: { id: string; name: string } | null; matchScore?: number;
}
export interface ChangeItem { id: string; costumeId: string; wearNotes?: string | null; costume: Costume }
export interface CostumeChange { id: string; characterId: string; changeNumber: number; name: string; description?: string | null; notes?: string | null; items: ChangeItem[]; character?: { id: string; name: string; actor?: { id: string; name: string } | null }; sceneCharacters?: { scene: { id: string; number: string; name?: string | null; shootDate?: string | null } }[]; photos?: Photo[]; _count?: { sceneCharacters: number } }
export interface SceneCharacter { id: string; sceneId: string; characterId: string; changeId?: string | null; notes?: string | null; character: Character & { changes?: { id: string; changeNumber: number; name: string }[] }; change?: (CostumeChange & { items?: ChangeItem[] }) | null }
export interface ScriptCue { id: string; sceneId: string; characterId?: string | null; characterName?: string | null; kind: string; text: string; quote?: string | null; confidence?: string | null; status: string; source: string; model?: string | null; createdAt: string; character?: { id: string; name: string } | null; scene?: { id: string; number: string; name?: string | null } }
export interface Scene { id: string; number: string; sortOrder: number; hasScript?: boolean; revision?: string | null; revisedAt?: string | null; aiEnabled?: boolean; cues?: ScriptCue[]; name?: string | null; location?: string | null; intExt?: string | null; timeOfDay?: string | null; scriptDay?: string | null; synopsis?: string | null; pages?: string | null; shootDate?: string | null; status: string; characters: SceneCharacter[]; readiness?: string; continuity?: ContinuityRecord[]; cleaning?: CleaningRequest[] }
export interface Readiness { scene: { id: string; number: string; name?: string | null }; overall: string; characters: { sceneCharacterId: string; character: Character; change: { id: string; changeNumber: number; name: string } | null; level: string; items: { costumeId: string; assetNumber: string; name: string; status: string; location: string; level: string; wearNotes?: string | null }[]; blockers: string[] }[] }
export interface CleaningLog { id: string; fromStatus?: string | null; toStatus: string; note?: string | null; byUserName?: string | null; createdAt: string }
export interface CleaningRequest {
  id: string; costumeId: string; sceneId?: string | null; takeNumber?: number | null; problem: string; cleaningType: string; priority: string; status: string; isEmergency: boolean;
  requestedByName?: string | null; assignedToId?: string | null; assignedToName?: string | null; expectedReadyAt?: string | null; startedAt?: string | null; completedAt?: string | null; qcResult?: string | null; qcNotes?: string | null; notes?: string | null; createdAt: string;
  costume: Costume; replacement?: { id: string; assetNumber: string; name: string } | null; scene?: { id: string; number: string; name?: string | null } | null; logs: CleaningLog[]; alternatives?: Costume[]; photos?: Photo[]; pipeline?: string[];
}
export interface FittingItem { id: string; costumeId: string; status: string; notes?: string | null; costume: Costume }
export interface Fitting { id: string; characterId: string; actorId?: string | null; scheduledAt: string; location?: string | null; status: string; notes?: string | null; character: Character & { actor?: Actor | null }; actor?: { id: string; name: string } | null; items: FittingItem[]; photos?: Photo[] }
export interface Alteration { id: string; costumeId: string; characterId?: string | null; issue: string; required: string; tailorName?: string | null; assignedToId?: string | null; priority: string; deadline?: string | null; status: string; notes?: string | null; createdAt: string; costume: Costume; character?: { id: string; name: string; actor?: { name: string } | null } | null }
export interface ContinuityRecord { id: string; sceneId: string; characterId: string; changeId?: string | null; takeNumber: number; notes?: string | null; details: Record<string, string>; accessories: { name: string; present: boolean }[]; recordedByName?: string | null; createdAt: string; scene?: { id: string; number: string; name?: string | null }; character?: { id: string; name: string; actor?: { name: string } | null }; change?: { id: string; changeNumber: number; name: string } | null; photos?: Photo[] }
export interface DamageReport { id: string; costumeId: string; sceneId?: string | null; takeNumber?: number | null; description: string; estimatedRepairCost?: number | null; responsible?: string | null; status: string; notes?: string | null; createdAt: string; costume: Costume; scene?: { id: string; number: string } | null; photos?: Photo[] }
export interface MissingItem { id: string; costumeId: string; lastSeenLocation?: string | null; lastAssignedTo?: string | null; lastScanAt?: string | null; status: string; notes?: string | null; createdAt: string; resolvedAt?: string | null; costume: Costume & { character?: { name: string } | null } }
export interface Vendor { id: string; name: string; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; _count?: { costumes: number; rentals: number } }
export interface Rental { id: string; costumeId: string; vendorId: string; ratePerDay: number; pickupDate: string; returnDate: string; status: string; notes?: string | null; costume: Costume; vendor: Vendor; isOverdue?: boolean; dueSoon?: boolean }
export interface Expense { id: string; category: string; amount: number; description: string; date: string; costumeId?: string | null; characterId?: string | null; sceneId?: string | null; vendorId?: string | null; costume?: { assetNumber: string; name: string } | null; character?: { name: string } | null; scene?: { number: string } | null; vendor?: { name: string } | null }
export interface Notification { id: string; type: string; severity: string; title: string; body: string; entityType?: string | null; entityId?: string | null; read: boolean; createdAt: string }
export interface TimelineEvent { at: string; kind: string; title: string; detail?: string | null; by?: string | null }
export interface Dashboard {
  project: Project; date: string;
  counts: { characters: number; costumes: number; todaysScenes: number; todaysCostumes: number; issuedToday: number; returnedToday: number; cleaning: number; alteration: number; missing: number; damaged: number; emergenciesToday: number; fittingsToday: number; rentalsDue: number; byStatus: Record<string, number> };
  priorities: { severity: string; text: string; link: string }[];
  todaysScenes: { id: string; number: string; name?: string | null; location?: string | null; timeOfDay?: string | null; status: string; level: string; characters: { characterId: string; name: string; change: string | null; level: string }[] }[];
}
export interface Member { id: string; userId: string; role: Role; user: User }
