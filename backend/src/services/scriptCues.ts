/**
 * Deterministic rule-based costume-cue extractor (no AI key needed).
 * Same cue shape as the AI extractor in costumeCues.ts. Pure and synchronous.
 * Pipeline: split lines (slug / cue / parenthetical / dialogue / time card / transition / action) -> sentences
 * -> anti-pattern spans -> special patterns (idioms, damage, stains, sweat, fire, crowds, hazards) -> noun phrases with
 * construction + attribution (wearer, recipient, possessive owner) -> dedupe by (character, kind, text).
 * Patterns live in scriptCuesLex.ts; word lists in scriptCuesVocab.ts.
 */
import { CUE_KINDS, SceneInput, ExtractedScene } from "./costumeCues";
import * as L from "./scriptCuesLex";

type Kind = (typeof CUE_KINDS)[number];
type Conf = L.Conf;
type Cue = { character: string | null; kind: Kind; text: string; quote: string | null; confidence: Conf };
interface RawCue extends Cue { key: string; line: number; at: number }
interface NameHit { name: string; start: number; end: number; poss: boolean; weak: boolean }
interface NameMatcher { forms: Map<string, { name: string; poss: boolean; weak: boolean }>; byLower: Map<string, string>; find: (s: string) => NameHit[] }
interface Attr { chars: string[]; conf: Conf; prefix: string; via: "name" | "pronoun" | "after" | "para" | "unknown" | "speaker" | "none" }
interface NP { start: number; headStart: number; end: number; head: string; written: string; mods: string[]; det: string; possName: string | null; kind: "GARMENT" | "ACCESSORY"; ambig: boolean; plural: boolean }
interface Sent { s: string; kind: "action" | "paren" | "dialogue"; names: NameHit[]; spans: L.Span[]; used: L.Span[]; paraNames: string[]; paraSubj: string | null; prevLast: string | null; speaker: string | null; present: string[]; allPresent: string[]; listRange: L.Span | null; listAttr: Attr | null; depict: boolean; line: number; at: number }
interface State { nm: NameMatcher; gender: Map<string, "M" | "F">; chars: string[]; out: RawCue[]; lastNP: { text: string; kind: "GARMENT" | "ACCESSORY"; owner: string | null; end: number } | null }

const NONE: Attr = { chars: [], conf: "MEDIUM", prefix: "", via: "none" };
/** True when the hit ends at or immediately before `pos` (whitespace only between). */
const justBefore = (s: string, h: NameHit, pos: number) => h.end <= pos && !s.slice(h.end, pos).trim();
const RANK: Record<Conf, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const minConf = (a: Conf, b: Conf): Conf => (RANK[a] <= RANK[b] ? a : b);
const npText = (np: NP) => [...np.mods, np.written].join(" ");
const named = (name: string): Attr => ({ chars: [name], conf: "HIGH", prefix: "", via: "name" });
const SUBJECT_VIAS = new Set(["name", "pronoun", "after", "speaker"]);
/** First noun after a possessive name ("Raj's friend", "Priya's desk"), used to tell a possessed object/person from the owner's own clothes. */
const POSS_NOUN_RE = /^\s+(?:(?:old|new|little|big|younger|older|elder|late|own|best|dead|left|right|bare|wet|muddy|torn|dirty|red|white|black|blue|green|grey|gray|brown|pink|yellow|gold|silver|cream)\s+)*([a-z][a-z-]+)(?:\s|,|$|'s)/i;
const POSS_SELF_RE = /^(?:hair|face|eyes?|cheeks?|forehead|hands?|arms?|neck|head|chest|nose|lips?|mouth|feet|foot|legs?|knees?|shoulders?|back|body|skin|wrists?|fingers?|ankles?|waist|hips?|torso|lap|beard|moustache|mustache|nails?|palms?|elbows?|thighs?|belly|stomach|figure|look|outfit|costume|clothes|clothing|get-up|wardrobe|uniform|jewellery|jewelry|jewels|makeup|make-up|mehendi|mehndi|bindi|sindoor|tattoo|scar|wound|bandage|pallu|collar|sleeves?|cuffs?|hem|pocket|pockets|lapel|buttons?|laces|sole|heels?|shirtfront|front|side|self)$/i;
const PART_WORD_RE = /^(?:sleeve|sleeves|lapel|lapels|hem|button|buttons|zip|zipper|seam|seams|lining|strap|straps|buckle|pocket|pockets|collar|collars|cuff|cuffs|brim|visor|peak|laces|heel|heels|toe|toes)$/i;
const ROLE_WORDS = new Set([...L.TITLE_WORDS, "waiter", "waitress", "nurse", "doctor", "guard", "cop", "constable", "officer", "soldier", "steward", "supervisor", "receptionist", "bouncer", "priest", "pandit", "servant", "maid", "driver", "clerk", "stranger", "beggar", "vendor", "mechanic", "policeman", "sepoy", "drunk", "passenger", "editor", "bride", "groom", "boy", "girl", "man", "woman", "grandmother", "grandfather", "landlord", "landlady", "manager", "teacher", "principal", "coach", "tailor", "dresser", "barman", "bartender", "cook", "chef", "peon", "watchman", "chowkidar", "dhobi", "milkman", "postman", "auto driver", "rickshaw puller", "conductor", "ticket collector", "compere", "anchor", "host", "hostess"]);

// ---------- names and genders ----------
function buildNameMatcher(characterNames: string[]): NameMatcher {
  const forms = new Map<string, { name: string; poss: boolean; weak: boolean }>();
  const byLower = new Map<string, string>();
  const counts = new Map<string, number>(); const articleOnly = new Set<string>();
  const tokensOf = (n: string) => n.split(/[\s-]+/).map((t) => t.replace(/'s$/i, "")).filter((t) => t.replace(/[^A-Za-z]/g, "").length >= 3);
  for (const n of characterNames) for (const t of L.uniq(tokensOf(n))) counts.set(t.toLowerCase(), (counts.get(t.toLowerCase()) || 0) + 1);
  const add = (form: string, name: string, poss: boolean, weak = false) => { if (form && !forms.has(form)) forms.set(form, { name, poss, weak }); };
  for (const raw of characterNames) {
    const name = raw.trim(); if (!name) continue;
    byLower.set(name.toLowerCase(), name);
    const multi = /\s/.test(name);
    const variants = L.uniq([name, name.toUpperCase(), L.title(name), ...(multi ? [name.toLowerCase(), L.cap(name.toLowerCase())] : [])]);
    for (const f of variants) { add(f, name, false); add(f + "'s", name, true); add(f + "'S", name, true); }
    // A single-word role name ("Waiter", "Nurse") is also written in lower case with an article: "a waiter in a white jacket".
    if (!multi && ROLE_WORDS.has(name.toLowerCase())) { const lc = name.toLowerCase(); add(lc, name, false, true); add(lc + "'s", name, true, true); }
    if (!multi) continue;
    for (const t of L.uniq(tokensOf(name))) {
      if (counts.get(t.toLowerCase()) !== 1 || characterNames.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
      const weak = L.TITLE_WORDS.has(t.toLowerCase());
      for (const f of L.uniq([L.title(t), t.toUpperCase()])) { add(f, name, false, weak); add(f + "'s", name, true, weak); add(f + "'S", name, true, weak); }
      // "the inspector's boots": a lower-case title word with a definite article refers to the only character with that title
      if (weak) { const lc = t.toLowerCase(); add(lc, name, false, true); add(lc + "'s", name, true, true); articleOnly.add(lc); articleOnly.add(lc + "'s"); }
    }
  }
  const re = forms.size ? new RegExp(`(?<![A-Za-z'-])(?:${[...forms.keys()].sort((a, b) => b.length - a.length).map(L.esc).join("|")})(?![A-Za-z-])`, "g") : null;
  const find = (s: string): NameHit[] => {
    const hits: NameHit[] = []; if (!re) return hits; re.lastIndex = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const f = forms.get(m[0])!;
      // lower-case role form: not a person when it is a comparison or disguise ("dressed as a waiter", "like a nurse"),
      // an appositive describing someone else ("Priya, a nurse, wears..."), or a title word without "the" ("an inspector arrives").
      if (m[0] === m[0].toLowerCase() && /\b(?:as|like|of|another|every|each|any|some|for)\s+(?:an?|the)?\s*$/i.test(s.slice(0, m.index))) continue;
      if (m[0] === m[0].toLowerCase() && /,\s*(?:an?|the)\s+$/i.test(s.slice(0, m.index)) && /^\s*,/.test(s.slice(m.index + m[0].length))) continue;
      if (articleOnly.has(m[0]) && !/\bthe\s+$/i.test(s.slice(0, m.index))) continue;
      hits.push({ name: f.name, start: m.index, end: m.index + m[0].length, poss: f.poss, weak: f.weak });
    }
    return hits;
  };
  return { forms, byLower, find };
}
const isActionLine = (l: string) => !!l.trim() && !/^\s/.test(l) && !/:$/.test(l.trim());
/** Verbs after which "his"/"her" usually belongs to someone else (borrowing, carrying, handing over, noticing). */
const TRANSFER_VERB_RE = /\b(?:wears?|wearing|has on|carries|carrying|holds?|holding|hands?|handing|gives?|giving|picks? up|returns?|borrows?|brings?|fetches|finds?|notices?|sees?|watches|touches|kisses|grabs?|catches|steals?|reads?|opens?|folds?|drapes?|throws?|tosses|passes|lends?|helps?|packs?|irons?|washes|mends?|sews?|hems?|alters?|slaps?|shoves?|hugs?|embraces?|admires?|eyes|inspects?|examines?|studies|follows?|joins?|meets?|calls?|tells?|asks?|answers?|thanks?|greets?|ignores?|spots?|leaves?|visits?|loves?|hates?|misses|remembers?|recognises?|recognizes?)\s+(?:his|her)\b/i;
function inferGenders(texts: string[], nm: NameMatcher, names: string[]): Map<string, "M" | "F"> {
  const votes = new Map<string, number>();
  for (const t of texts) for (const line of t.split("\n")) {
    if (!isActionLine(line)) continue;
    for (const sn of L.sentences(line)) {
      const hits = nm.find(sn.text).filter((h) => !h.poss); const uniqNames = L.uniq(hits.map((h) => h.name)); if (uniqNames.length !== 1) continue;
      const after = sn.text.slice(hits[0].end);
      const add = (n: number) => votes.set(uniqNames[0], (votes.get(uniqNames[0]) || 0) + n);
      // subject pronouns / reflexives are strong evidence; "his"/"her" only when not the object of a transfer verb ("Priya is wearing his sweatshirt", "Raj carries her bag")
      if (/\b(he|himself)\b/i.test(after)) add(2);
      if (/\b(she|herself)\b/i.test(after)) add(-2);
      const possOk = !TRANSFER_VERB_RE.test(after);
      if (possOk && /\bhis\b/i.test(after)) add(1);
      if (possOk && /\bher\b(?!\s+(?:the|a|an|his|it|them)\b)/i.test(after)) add(-1);
    }
  }
  const g = new Map<string, "M" | "F">();
  for (const n of names) {
    const v = votes.get(n) || 0;
    if (Math.abs(v) >= 2) g.set(n, v > 0 ? "M" : "F");
    else if (L.FEMALE_HINT.test(n)) g.set(n, "F");
    else if (L.MALE_HINT.test(n)) g.set(n, "M");
    else if (v) g.set(n, v > 0 ? "M" : "F");
    else if (/[ai]$/i.test(n.split(/\s+/).pop() || "")) g.set(n, "F");
  }
  return g;
}

// ---------- attribution ----------
/** Names coordinated with `hit` by "and" / commas in both directions: "Raj, Priya and Vikram". */
function coord(sent: Sent, hit: NameHit): string[] {
  const s = sent.s; const link = /^\s*(?:\([^)]*\)\s*)?(?:,|and|,\s*and|&)\s*(?:\([^)]*\)\s*)?$/i; // "RAJ (35) and PRIYA (30)"
  const list = sent.names.filter((h) => !h.poss).sort((a, b) => a.start - b.start);
  let i = list.indexOf(hit); if (i < 0) return [hit.name];
  let lo = i, hi = i;
  while (lo > 0 && link.test(s.slice(list[lo - 1].end, list[lo].start))) lo--;
  while (hi < list.length - 1 && link.test(s.slice(list[hi].end, list[hi + 1].start))) hi++;
  const chain = list.slice(lo, hi + 1).map((h) => h.name);
  // a bare comma between two names is only a list when an "and" closes it somewhere in the chain
  if (chain.length > 2 || (chain.length === 2 && /\band\b|&/.test(s.slice(list[lo].end, list[hi].start)))) return L.uniq(chain);
  return [hit.name];
}
function resolvePronoun(st: State, sent: Sent, pron: string, pos: number, exclude: string[] = []): Attr {
  const p = pron.toLowerCase();
  const g = /^(he|him|his|himself)$/.test(p) ? "M" : /^(she|her|herself)$/.test(p) ? "F" : null;
  if (sent.kind !== "action") {
    if (!sent.speaker) return NONE;
    // a name inside the parenthetical beats the speaker: "(to Priya, fixing her earring)", "(handing Raj his coat)"
    const inParen = sent.names.filter((h) => !h.poss && h.end <= pos && h.name !== sent.speaker && !exclude.includes(h.name) && (!g || !st.gender.get(h.name) || st.gender.get(h.name) === g));
    if (inParen.length) return { chars: [inParen[inParen.length - 1].name], conf: "HIGH", prefix: "", via: "name" };
    const sg = st.gender.get(sent.speaker);
    if (g && sg && sg !== g) { // "(straightening his tie)" spoken by a woman: the other person present
      const others = L.uniq(sent.allPresent.filter((c) => c !== sent.speaker && (!st.gender.get(c) || st.gender.get(c) === g)));
      return others.length === 1 ? { chars: others, conf: "MEDIUM", prefix: "", via: "pronoun" } : NONE;
    }
    return { chars: [sent.speaker], conf: "HIGH", prefix: "", via: "speaker" };
  }
  // "He loosens his tie": a possessive later in the sentence follows the sentence-initial subject pronoun of the same gender
  if (g && pos > 0 && !sent.names.some((h) => !h.poss && h.end <= pos)) { const lead = /^\s*(he|she)\b/i.exec(sent.s); if (lead && (lead[1].toLowerCase() === "he") === (g === "M")) return resolvePronoun(st, sent, lead[1], lead.index + lead[0].indexOf(lead[1]), exclude); }
  const before = sent.names.filter((h) => h.end <= pos);
  const seq = [...before.map((h) => h.name).reverse(), ...[...sent.paraNames].reverse(), ...(sent.prevLast ? [sent.prevLast] : [])];
  const cands = L.uniq(seq).filter((c) => !exclude.includes(c));
  if (!g) {
    const last = [...before].filter((h) => !h.poss).pop();
    const chain = last ? coord(sent, last).filter((c) => !exclude.includes(c)) : [];
    if (chain.length >= 2) return { chars: chain, conf: "MEDIUM", prefix: "", via: "pronoun" };
    const pair = cands.slice(0, 2); return pair.length ? { chars: pair, conf: "MEDIUM", prefix: "", via: "pronoun" } : NONE;
  }
  const fit = cands.filter((c) => !st.gender.get(c) || st.gender.get(c) === g);
  const known = fit.filter((c) => st.gender.get(c) === g);
  // a sentence-initial "He"/"She" continues the previous sentence's subject ("Raj sits with Vikram. He loosens his tie.") unless a known-gender match says otherwise
  let pick = known[0] || (pos === 0 && /^(he|she|they)$/.test(p) && sent.paraSubj && fit.includes(sent.paraSubj) ? sent.paraSubj : fit[0]);
  if (!pick) { const all = st.chars.filter((c) => !exclude.includes(c) && (!st.gender.get(c) || st.gender.get(c) === g)); if (all.length === 1) pick = all[0]; }
  return pick ? { chars: [pick], conf: "MEDIUM", prefix: "", via: "pronoun" } : NONE;
}
/** Who a construction at `pos` belongs to: nearest subject-like token before it, else a name after it (comma-joined), else the paragraph. */
function subjectFor(st: State, sent: Sent, pos: number): Attr {
  const { s } = sent;
  if (sent.kind !== "action") return sent.speaker ? { chars: [sent.speaker], conf: "HIGH", prefix: "", via: "speaker" } : NONE;
  if (sent.listRange && sent.listAttr && pos >= sent.listRange[0] && pos <= sent.listRange[1]) return sent.listAttr;
  let best: { at: number; attr: Attr } | null = null;
  const consider = (at: number, attr: Attr) => { if (!best || at > best.at) best = { at, attr }; };
  for (const h of sent.names) {
    if (h.end > pos) continue;
    if (h.poss) {
      // "Raj's friend wears...", "Priya's desk is covered in dust": the possessed noun is the subject, not the owner.
      const nm = POSS_NOUN_RE.exec(s.slice(h.end, pos)); const noun = nm?.[1].toLowerCase();
      if (noun && !POSS_SELF_RE.test(noun) && !L.canon(noun) .match(new RegExp(`^(?:${L.HEAD_ALT})$`, "i")) && !PART_WORD_RE.test(noun)) { consider(h.start, { chars: [], conf: "MEDIUM", prefix: `${h.name}'s ${noun}: `, via: "unknown" }); continue; }
      consider(h.start, { chars: [h.name], conf: "MEDIUM", prefix: "", via: "name" });
    } else consider(h.start, { chars: coord(sent, h), conf: h.weak ? "MEDIUM" : "HIGH", prefix: "", via: "name" });
  }
  const pre = s.slice(0, pos); let m: RegExpExecArray | null;
  const pr = /\b(he|she|they|his|her|their)\b/gi;
  while ((m = pr.exec(pre))) {
    // object pronoun right before the construction ("hands her a hat") or "her" as an object before another noun phrase: not the subject
    const rest = pre.slice(m.index + m[0].length);
    if (/^(his|her|their)$/i.test(m[1]) && (!rest.trim() || /^\s+(?:a|an|the|some|this|that|these|those|another|two|three|back)\b/i.test(rest))) continue;
    consider(m.index, resolvePronoun(st, sent, m[1], m.index));
  }
  const capsRe = /(?:^|[.;,]\s*|\s)(?:A|AN|THE|YOUNG|YOUNGER|OLDER|AN OLDER)?\s*([A-Z][A-Z'-]{2,}(?:\s[A-Z][A-Z'-]{2,})?)(?=[\s,.(]|$)/g;
  while ((m = capsRe.exec(pre))) {
    const at = m.index + m[0].indexOf(m[1]); const word = m[1].trim();
    if (L.SFX.has(word) || word.split(" ").some((w) => L.SFX.has(w)) || sent.names.some((h) => h.start <= at && h.end >= at + word.length) || /\b(?:his|her|their)\s+$/i.test(s.slice(0, at))) continue;
    consider(at, { chars: [], conf: "MEDIUM", prefix: L.title(word) + ": ", via: "unknown" });
  }
  const role = new RegExp(L.ROLE_RE.source, "gi");
  while ((m = role.exec(pre))) {
    if (/\b(?:as|like|of)\s+$/i.test(pre.slice(0, m.index))) continue;
    // a role word that is also a production character ("Waiter", "Nurse") was already matched by name: let that attribution win
    const roleAt = m.index + m[0].indexOf(m[1]);
    const roleEnd = roleAt + m[1].length;
    if (sent.names.some((h) => h.start <= roleEnd && h.end >= roleAt)) continue;
    consider(m.index, { chars: [], conf: "MEDIUM", prefix: L.title(m[1]) + ": ", via: "unknown" });
  }
  if (best) return (best as { at: number; attr: Attr }).attr;
  for (const h of sent.names) {
    if (h.start < pos || h.poss) continue;
    const between = s.slice(pos, h.start);
    if (/,\s*(?:(?:an?|the)\s+)?(?:older|younger|young|old)?\s*$/i.test(between) && !/[.;]/.test(between)) return { chars: coord(sent, h), conf: "HIGH", prefix: "", via: "after" };
    break;
  }
  const para = L.uniq([...sent.paraNames].reverse());
  if (para.length) return { chars: [para[0]], conf: "MEDIUM", prefix: "", via: "para" };
  if (sent.prevLast && !sent.names.length) return { chars: [sent.prevLast], conf: "MEDIUM", prefix: "", via: "para" };
  return NONE;
}
function ownerAttr(st: State, sent: Sent, owner: string, at: number): Attr {
  const o = owner.toLowerCase();
  if (/^(his|her|their)$/.test(o)) return resolvePronoun(st, sent, o, at);
  if (o === "the") return subjectFor(st, sent, at);
  const h = sent.names.find((x) => x.poss && x.start === at); return h ? named(h.name) : NONE;
}
/** A person named or referred to at `at` (a name hit, or an object pronoun resolved away from `exclude`). */
function personAt(st: State, sent: Sent, at: number, exclude: string[] = []): Attr | null {
  const h = sent.names.find((x) => x.start === at); if (h) return named(h.name);
  const pm = /^(him|her|them|his|their)\b/.exec(sent.s.slice(at)); if (!pm) return null;
  const a = resolvePronoun(st, sent, pm[1], at, /^(?:him|her|them)$/.test(pm[1]) ? exclude : []);
  return a.chars.length ? a : null;
}

// ---------- emit ----------
function quoteFor(s: string): string {
  const t = s.trim(); if (t.length <= 160) return t;
  const cut = t.lastIndexOf(" ", 156); return t.slice(0, cut > 80 ? cut : 156).trim() + "…";
}
function emit(st: State, sent: Sent, attr: Attr, kind: Kind, text: string, conf: Conf, at: number, key?: string): void {
  const body = L.cap(text.trim().replace(/\s+/g, " ").split(" ").slice(0, 20).join(" ")); if (!body) return;
  const c = minConf(conf, attr.chars.length || attr.prefix ? attr.conf : "HIGH");
  const base = { kind, quote: quoteFor(sent.s), line: sent.line, at: sent.at + at };
  const k = (key || body).toLowerCase();
  if (attr.chars.length) for (const ch of attr.chars) st.out.push({ ...base, character: ch, text: body, key: `${ch.toLowerCase()}|${kind}|${k}`, confidence: c });
  else if (attr.prefix) { const t = L.cap(attr.prefix + body.charAt(0).toLowerCase() + body.slice(1)); st.out.push({ ...base, character: null, text: t, key: `|${kind}|${attr.prefix.toLowerCase()}${k}`, confidence: minConf(c, "MEDIUM") }); }
  else if (kind === "NOTE" || kind === "CONTINUITY") st.out.push({ ...base, character: null, text: body, key: `|${kind}|${k}`, confidence: c });
}
/** Hazard-style note; deduped per (character, family) so a scene lists each hazard once per person. */
function note(st: State, sent: Sent, attr: Attr, family: string, trigger: string, consequence: string, conf: Conf, at: number): void {
  const w = trigger.toLowerCase().replace(/^(?:is|are|was|were|gets|got)\s+/, "").replace(/\b(?:the|a|an)\s+/g, "").replace(/^(?:in|into|onto|through|out of|of)\s+/, "").trim().split(/\s+/).filter(Boolean);
  const trig = /^(?:covered|caked|plate|drenched|soaked|smeared|spattered|splattered|streaked)$/.test(w[0]) && w.length > 1 ? w[w.length - 1] : w.length <= 3 ? w.join(" ") : `${w[0]} ${w[w.length - 1]}`;
  emit(st, sent, attr, "NOTE", `${family} (${trig}): ${consequence}`, conf, at, `hazard ${family}`);
}
const FAMILY: Record<number, [string, string]> = { 0: ["Rain/water", "wet costumes, duplicates, drying"], 4: ["Blood", "duplicates, blood prep"], 6: ["Holi/colour", "colour-fast duplicates, everyone stained"], 7: ["Mud/dirt", "breakdown, duplicates"] };
/** Hazard note for a condition word ("soaked" -> Rain/water, "muddy" -> Mud/dirt, "burnt" -> Fire/smoke). */
function condNote(st: State, sent: Sent, attr: Attr, cond: string, at: number): void {
  const c = cond.toLowerCase();
  const fam = /sweat/.test(c) ? ["Sweat", "spare shirts"] : /burn|singe|char|scorch|soot/.test(c) ? ["Fire/smoke", "FR duplicates, burnt breakdown"] : /blood/.test(c) ? FAMILY[4] : /gulal|haldi|turmeric|colour|paint/.test(c) ? FAMILY[6] : /mud|dust|dirt|filth|grim|greas|oil/.test(c) ? FAMILY[7] : /wet|soak|drench|dripping|sodden|sopping|snow|frozen|damp/.test(c) ? FAMILY[0] : /ruin|torn|ripped|shred|tatter|slash|frayed|split|snagged|burst/.test(c) ? ["Damage", "repair, duplicates"] : /vomit/.test(c) ? ["Spill", "duplicates, cleaning"] : null;
  if (fam) note(st, sent, attr, fam[0], cond, fam[1], "MEDIUM", at);
}
function condCue(st: State, sent: Sent, attr: Attr, text: string, at: number, conf: Conf = "MEDIUM"): void { emit(st, sent, attr, "CONDITION", text, conf, at); }
const use = (sent: Sent, a: number, b: number) => sent.used.push([a, b]);

// ---------- noun phrases ----------
/** Wearing / handling / negation context (with the determiner) that licenses an unknown adjective before a strong-ambiguous head. */
const WEAR_LEAD_RE = /\b(?:wears?|wearing|has on|puts? on|pulls? on|slips? on|pulling on|putting on|takes? off|pulls? off|removes?|dons?|sports?|dressed in|clad in|tries on|checks?|consults|glances at|adjusts?|straightens?|fiddles with|twists?|clutches|no|without|in|with|and|,)\s+(?:(?:a|an|the|his|her|their|my|your|its|matching|some|that|those|these|another)\s+)?$/i;
const CHANGE_MOD_RE = /^(?:different|another|fresh|clean|dry)$/;
function findNPs(sent: Sent): NP[] {
  const { s } = sent; const out: NP[] = []; const re = new RegExp(L.HEAD_RE.source, "gi"); let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const headStart = m.index, end = m.index + m[0].length;
    if (L.overlaps(sent.spans, headStart, end) || L.overlaps(sent.used, headStart, end)) continue;
    if (sent.names.some((h) => h.start < end && h.end > headStart)) continue; // a character called Payal / Kit / Nath
    if (/^\s+(?:button|pocket|hanger|rack|shop|store|factory|room|drawer|stand|strap|buckle)s?\b/i.test(s.slice(end))) continue;
    // Title-case single word mid-sentence is a proper noun: "the Boot Inn", "the Crown".
    if (/^[A-Z][a-z]/.test(m[0]) && !/[\s-]/.test(m[1]) && headStart > 0 && !/(?:^|[.!?]|["'(])\s*$/.test(s.slice(0, headStart))) continue;
    const head = L.canon(m[1]); const plural = !!m[2]; const after = s.slice(end);
    if (L.PAIR_ONLY.has(head) && !plural && !L.MOD_TAIL_RE.test(s.slice(0, headStart))) continue; // "the flat", "his heel", "the platform"
    if (L.PARTITIVE_RE.test(after)) continue; // "coat of varnish", "veil of mist"
    if (L.AMBIG.has(head) && !L.afterHeadOk(after)) continue; // "top shelf", "top brass", "boot inn"
    const mods: string[] = []; let start = headStart; let unknownUsed = 0;
    for (let i = 0; i < 20; i++) {
      const pre = s.slice(0, start); const mm = L.MOD_TAIL_RE.exec(pre);
      if (mm) { mods.unshift(mm[1].toLowerCase()); start = mm.index + (/^[\s,]/.test(mm[0]) ? 1 : 0); continue; }
      const am = /(?:^|\s)([a-z]+)\s*$/.exec(pre);
      if (am && L.ADV_SKIP.has(am[1])) { start = am.index + am[0].indexOf(am[1]); continue; }
      if (unknownUsed < 2) {
        const strong = L.STRONG_AMBIG.has(head);
        // a capitalised style word after a determiner is a modifier too: "a Nehru cap", "a Kashmiri shawl" (never a character name)
        const um = /,\s*$/.test(pre) ? null : L.UNKNOWN_ADJ_RE.exec(pre) || /(?:^|\s)([A-Z][a-z]{2,})\s*$/.exec(pre); const w = um?.[1];
        if (um && w && !L.ADJ_STOP.has(w.toLowerCase()) && !L.FINITE_RE.test(w) && (L.KNOWN_ING.has(w) || !/(?:ing|ed|ly)$/.test(w))) {
          const wAt = um.index + um[0].indexOf(w); const before = pre.slice(0, wAt); const isCap = /^[A-Z]/.test(w);
          const nameHere = sent.names.some((h) => h.start <= wAt && h.end >= wAt + w.length);
          const detLead = L.ADJ_LEAD_RE.test(before) || sent.names.some((h) => h.poss && justBefore(s, h, wAt));
          // strong-ambiguous heads ("ring", "cap", "watch") take an unknown adjective only after a determiner/possessive: "a signet ring", "his digital watch"
          const ok = !nameHere && (isCap ? detLead && (strong ? WEAR_LEAD_RE.test(before) : true) : strong ? detLead && WEAR_LEAD_RE.test(before) : L.KNOWN_ING.has(w) || detLead || /(?:^|\s)(?:very|quite|rather|slightly|somewhat|extremely|too|so)\s*$/.test(before));
          if (ok) { mods.unshift(w.toLowerCase()); start = wAt; unknownUsed++; continue; }
        }
      }
      break;
    }
    let det = "", possName: string | null = null;
    const dm = L.DET_RE.exec(s.slice(0, start));
    if (dm) { det = dm[1].toLowerCase(); start = dm.index + (/^\s/.test(dm[0]) ? 1 : 0); }
    else { const ph = sent.names.find((h) => h.poss && justBefore(s, h, start)); if (ph) { possName = ph.name; start = ph.start; } }
    if (!det && !mods.length && !possName && !L.BODY_CTX_RE.test(after)) {
      if (L.VERB_AFTER_RE.test(after) || L.SUBJ_PRONOUN_BEFORE_RE.test(s.slice(0, headStart)) || sent.names.some((h) => !h.poss && justBefore(s, h, headStart))) continue;
    }
    out.push({ start, headStart, end, head, written: m[0].toLowerCase(), mods, det, possName, kind: L.kindOfHead(head), ambig: L.AMBIG.has(head), plural });
  }
  return out;
}
type Ctx = "still" | "same" | "on" | "off" | "into" | "tries" | "now" | "wear" | "in" | "with" | "handle" | "look" | "state" | "neg" | "drop" | "change" | "strip" | "container" | "comma" | "none";
const CTX: [RegExp, Ctx][] = [
  [/\b(?:puts?|tucks?|stuffs?|shoves?|drops?|slips?|packs?|throws?|places?|folds?|stows?|dumps?|pushes|slides?)\s+(?:it|them|this|that|these|those|the\s+\w+|his\s+\w+|her\s+\w+)\s+(?:into|in|inside)\s*$/i, "container"],
  [/\bstill\s+(?:in|wearing|wears|has on)\s*$/i, "still"], [/\b(?:the\s+)?(?:same|identical)\s*$/i, "same"],
  [/\b(?:puts?|pulls?|throws?|slips?|shrugs?|tugs?|drags?|straps?|clips?|pins?|putting|pulling|throwing|slipping|shrugging|tugging|dragging)\s+(?:back\s+)?on\s*$/i, "on"],
  [/\b(?:takes?|peels?|pulls?|kicks?|slips?|rips?|tears?|strips?|shrugs?|tugs?|yanks?|takes?|taking|peeling|kicking|tugging|slipping|pulling|ripping|tearing|shrugging)\s+off\s*$/i, "off"],
  [/\b(?:removes?|sheds?|discards?|unhooks?|unclasps?|unpins?|unties?|unbuckles?|removing|unhooking|shedding)\s*$/i, "off"],
  [/\b(?:drops?|dropped|dropping|loses|lost)\s*$/i, "drop"],
  [/\b(?:changes?|changed|steps?|slips?|climbs?|gets?|wriggles?|changing|stepping|slipping)\s+into\s*$/i, "into"],
  [/\b(?:emerges?|appears?|returns?|reappears?|re-?enters?|comes? back|arrives? back)\s+in\s*$/i, "into"],
  [/\b(?:strips?|stripped|stripping)\s+(?:down\s+)?to\s*$/i, "strip"],
  [/\b(?:changes?|changed|changing|swaps?|swapped|switches)\s*$/i, "change"],
  [/\bnow\s+(?:in|wearing|wears|dressed in|clad in|has on|sports|sporting)\s*$/i, "now"], [/\b(?:tries|trying|try)\s+on\s*$/i, "tries"], [/\b(?:dons?|donning|drapes?|winds?|wraps?\s+(?:himself|herself|themselves)\s+in)\s*$/i, "on"],
  [/\b(?:wears?|wearing|has on|dressed in|clad in|decked out in|kitted out in|draped in|wrapped in|sports|sporting)\s*$/i, "wear"],
  [/\b(?:loosens?|loosening|tightens?|tightening|unbuttons?|unbuttoning|undoes|undoing|unzips?|unzipping|rolls? up|rolling up|untucks?|hitches? up|unfastens?|unlaces?|buttons? up|zips? up|fastens?|zips?|buttons?|knots?|laces?|buckles?|clasps?|ties?|unties?|unclasps?|unbuckles?)\s*$/i, "state"],
  [/\b(?:holds?|holding)\s+(?:up|out)|\b(?:shows?|showing|examines?|inspects?|unfolds?|unpacks?|hangs? up|irons?|ironing|washes|washing|buys|buying|sells|admires?|eyes|considers?|browses?|glances at|looks at|stares at|studies|points at|gestures at|unwraps?|lays out|sets out|lays|spreads out)\s*$/i, "look"],
  [/\b(?:checks?|consults|taps|twists?|fiddles with|toys with|fingers|touches|clutches|clutching|grips|carries|carrying|holds|holding|swings|slings|shoulders|hefts|opens|snaps open|adjusts?|adjusting|straightens?|straightening|pushes|pushes up|flicks|tilts|tips|doffs|lifts|pins|smooths?|smoothes|wraps?|pulls?|raises|picks up|checking|twisting|pushing|wrapping)\s*$/i, "handle"],
  [/\b(?:no|without|minus|sans|not wearing|missing|lost|forgot|forgets)\s*$/i, "neg"],
  [/\b(?:in|into)\s*$/i, "in"], [/\bwith\s*$/i, "with"], [/,\s*$/, "comma"],
];
function ctxFor(s: string, np: NP): { ctx: Ctx; at: number } {
  let pre = s.slice(0, np.start);
  if (np.det === "yesterday's") pre = pre.replace(/\s*$/, "");
  for (const [re, c] of CTX) { const m = re.exec(pre); if (m) return { ctx: c, at: m.index }; }
  return { ctx: "none", at: np.start };
}
function condPredicate(s: string, pos: number): { states: string; still: boolean; now: boolean; end: number } | null {
  L.PRED_RE.lastIndex = pos; const m = L.PRED_RE.exec(s);
  if (m) {
    // "a torn kurta and muddy sandals": the state after "and" modifies the next garment, it is not a predicate of this one
    if (NEXT_HEAD_RE.test(s.slice(pos + m[0].length)) && !/\b(?:is|are|was|were|now|still|looks|hangs|clings|already)\b/i.test(m[1])) return null;
    const extra = (m[4] || "").replace(/\s*,\s*/g, " and ").replace(/\s+/g, " ");
    let end = pos + m[0].length; let sub = "";
    const withSub = new RegExp(`^\\s+(?:with|in)\\s+(${L.SUBS})${L.B1}`, "i").exec(s.slice(end)); if (withSub) { sub = ` with ${withSub[1].toLowerCase()}`; end += withSub[0].length; }
    return { states: `${m[2].toLowerCase()}${m[3] ? " through" : ""}${extra.toLowerCase()}${sub}`, still: /\bstill\b/i.test(m[1]), now: /\bnow\b/i.test(m[1]), end };
  }
  const fit = L.FIT_RE.exec(s.slice(pos)); if (fit) return { states: fit[1].toLowerCase(), still: false, now: false, end: pos + fit[0].length };
  if (/^\s+(?:drags|trails|sinks)\s+in(?:to)?\s+the\s+mud\b/i.test(s.slice(pos))) return { states: "muddy", still: false, now: false, end: pos };
  return null;
}
const NEXT_HEAD_RE = new RegExp(`^\\s+(?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT})(?:es|s)?${L.B1}`, "i");
const FROM_RE = /^\s*(?:from|as(?:\s+in)?)\s+(scene\s+\d+|sc\.?\s*\d+|the\s+(?:wedding|party|funeral|fight|alley|night before|day before|previous scene|earlier scene|morning|office|match|sangeet|reception|hospital)|earlier|before|last night|yesterday)/i;
const NOT_WORN_RE = /^\s+(?:lies|lying|hangs|hanging|sits|is draped|is folded|is (?:on|in) the|on the (?:chair|bed|floor|hook|peg|rack|back|sofa|table|counter|shelf|hanger)|in the (?:wardrobe|closet|cupboard|suitcase|bag|wash|laundry|shop|window|display)|on display|on a hanger|on a mannequin|in (?:a|the) shop window)\b/i;
const WEAR_CTX = new Set<Ctx>(["wear", "on", "into", "off", "still", "same", "now", "tries", "in", "change", "strip"]);
const CHANGE_CTX = new Set<Ctx>(["on", "off", "into", "tries", "now", "change", "strip"]);
function handleNP(st: State, sent: Sent, np: NP, ctx: Ctx, attr: Attr, giver: { attr: Attr; mode: "hand" | "place" } | null, borrowed: string | null): void {
  const { s } = sent; const at = np.start; const after = s.slice(np.end);
  const text = borrowed ? `${npText(np)} (${borrowed}'s)` : npText(np);
  if (sent.depict) { if (attr.via === "name" && attr.chars.length) emit(st, sent, attr, "NOTE", `Depicted (photo), not worn: ${text}`, "LOW", at); return; }
  if (ctx === "container") return;
  if (ctx === "in" && L.CONTAINER.has(np.head)) return; // "tucks it into the suitcase"
  const bodyCtx = L.BODY_CTX_RE.test(after);
  const bareDet = !np.det || /^(?:a|an|the|some|that|those|these|a pair of|a set of)$/.test(np.det);
  const inList = !!sent.listRange && np.headStart >= sent.listRange[0] && np.headStart <= sent.listRange[1];
  const pairPlural = np.plural && L.PAIR_ONLY.has(np.head); // "in heels", "heels," in an intro list
  if (np.ambig && !np.mods.length && !np.possName && bareDet && !inList) {
    if (!np.det && !["wear", "on", "off", "into", "tries", "now", "still", "same", "change", "strip", "neg"].includes(ctx) && !(pairPlural && ctx === "in")) return;
    if (L.STRONG_AMBIG.has(np.head) && !bodyCtx) {
      const ok = ["wear", "tries", "now", "neg", "state", "same"].includes(ctx) || (ctx === "drop" && L.JEWEL_LIKE.has(np.head)) || (!!giver && L.JEWEL_LIKE.has(np.head)) || (pairPlural && ctx === "in");
      if (!ok) return;
    }
  }
  // "pulls a sweater on", "tears his shirt off": a trailing particle turns a handled garment into a change
  const tailOn = /^\s+(?:back\s+)?on(?=[,.;!?]|\s+(?:and|then|again|over|as|before|quickly|slowly|with|while)\b|$)/i.test(after) && /\b(?:pulls?|tugs?|drags?|slips?|shrugs?|throws?|puts?|yanks?|gets?|has|wriggles?|struggles?|eases?)\s+(?:(?:a|an|the|his|her|their|my|some)\s+)?$/i.test(s.slice(0, np.start));
  const tailOff = /^\s+(?:back\s+)?(?:off|away)(?=[,.;!?]|\s+(?:and|then|again|over|as|before|quickly|slowly|with|while|in one)\b|$)/i.test(after) && /\b(?:tears?|rips?|pulls?|takes?|peels?|kicks?|shrugs?|yanks?|tugs?|strips?|throws?|wrenches|drags?|slips?|gets?|wriggles?|eases?|shakes?|casts?|flings?)\s+(?:(?:a|an|the|his|her|their|my)\s+)?$/i.test(s.slice(0, np.start));
  const overHead = /^\s+(?:on\s+|down\s+)?over\s+(?:his|her|their|my)\s+head\b/i.test(after) && /\b(?:pulls?|tugs?|yanks?|drags?|slips?|drops?)\s+(?:(?:a|an|the|his|her|their|my)\s+)?$/i.test(s.slice(0, np.start));
  if ((ctx === "handle" || ctx === "none" || ctx === "comma") && !giver) { if (tailOn || overHead) ctx = "on"; else if (tailOff) ctx = "off"; }
  const owned = !!np.possName || /^(his|her|their|my)$/.test(np.det);
  const pred = CHANGE_CTX.has(ctx) ? null : condPredicate(s, np.end);
  if (ctx === "comma" && !bodyCtx && !inList && !owned && !giver) return;
  if (ctx === "none" && !bodyCtx && !owned && !giver && (attr.via === "para" || attr.via === "none" || attr.via === "unknown" || (!np.det && !np.mods.length))) {
    // "The grey hoodie is torn." — a definite garment with a condition predicate still tells wardrobe something.
    if (pred && attr.chars.length && np.det) condCue(st, sent, attr, `${text} ${pred.states}`, at);
    return;
  }
  if (!attr.chars.length && !attr.prefix) return;
  const conds = np.mods.filter(L.isCondMod).filter((c) => !/^(?:nude|naked)$/.test(c)); // "nude heels" is a colour
  if (np.det === "yesterday's") emit(st, sent, attr, "CONTINUITY", `Yesterday's ${text}: same as previous day`, "HIGH", at);
  const from = FROM_RE.exec(after);
  const changeMod = np.det === "another" ? "another" : np.mods.find((w) => CHANGE_MOD_RE.test(w)) || (/^new$/.test(np.mods[0] || "") && /^(?:outfit|clothes|clothing|look|get-up|costume)$/.test(np.head) ? "new" : null);
  if (changeMod && !CHANGE_CTX.has(ctx) && ctx !== "look" && ctx !== "drop") {
    // "a different saree from the morning", "another shirt", "fresh clothes": an explicit new outfit, not a carry-over
    const label = changeMod === "another" ? `Another ${npText(np)}` : `${L.cap(text)}`;
    emit(st, sent, attr, "CHANGE", `${label}${from ? ` from ${from[1].replace(/^scene/i, "Scene")}` : ""} (new outfit)`, /^(?:different|another)$/.test(changeMod) ? "HIGH" : "MEDIUM", at);
    emit(st, sent, attr, np.kind, changeMod === "another" ? npText(np) : text, "MEDIUM", at);
    for (const c of conds) { condCue(st, sent, attr, `${c} ${np.written}`, at); condNote(st, sent, attr, c, at); }
    return;
  }
  if (ctx === "still" || ctx === "same") {
    emit(st, sent, attr, "CONTINUITY", `${ctx === "still" ? "Still in" : "Same"} ${text}${from ? ` (from ${from[1].replace(/^scene/i, "Scene")})` : " (same as earlier)"}`, "HIGH", at);
    emit(st, sent, attr, np.kind, text, "MEDIUM", at);
  } else if (giver) {
    const by = giver.attr.chars.length ? ` by ${giver.attr.chars[0]}` : ""; const who = attr.chars.join(" and ");
    if (giver.mode === "hand") { emit(st, sent, attr, np.kind, `${text} (handed over${by})`, "MEDIUM", at); if (by) emit(st, sent, giver.attr, "NOTE", `Hands over ${text} to ${who}`, "MEDIUM", at); }
    else if (CHANGE_CTX.has(ctx) || ctx === "handle") { emit(st, sent, attr, "CHANGE", `Puts on ${text} (draped over${by})`, "MEDIUM", at); if (by) emit(st, sent, giver.attr, "NOTE", `Puts ${text} on ${who}`, "MEDIUM", at); }
    else { emit(st, sent, attr, np.kind, `${text} (put on${by})`, "MEDIUM", at); if (by) emit(st, sent, giver.attr, "NOTE", `Puts ${text} on ${who}`, "MEDIUM", at); }
  } else if (CHANGE_CTX.has(ctx)) {
    const verb = ctx === "on" ? "Puts on" : ctx === "off" ? "Takes off" : ctx === "tries" ? "Tries on" : ctx === "now" ? "Now in" : ctx === "change" ? "Changes" : ctx === "strip" ? "Strips to" : "Changed into";
    emit(st, sent, attr, "CHANGE", `${verb} ${text}`, "HIGH", at);
    if (ctx === "strip") emit(st, sent, attr, "NOTE", "Modesty: robe, closed set", "MEDIUM", at);
  } else if (ctx === "drop") emit(st, sent, attr, np.kind, `${text} (dropped)`, "MEDIUM", at);
  else if (ctx === "neg") emit(st, sent, attr, np.kind, `No ${text}`, "HIGH", at);
  else if (from && (ctx === "wear" || ctx === "in" || owned)) emit(st, sent, attr, "CONTINUITY", `${text} from ${from[1].replace(/^scene/i, "Scene")} (carry-over)`, "HIGH", at);
  else {
    if (L.BARE_FEET.test(np.head)) { emit(st, sent, attr, "ACCESSORY", "Barefoot (no footwear)", "HIGH", at); return; }
    const notWorn = ctx === "look" || NOT_WORN_RE.test(after) || (ctx === "handle" && /^\s+in\s+(?:the|a)\s+(?:shop|window|display|case|box|drawer|cupboard)/i.test(after));
    const carried = /^\s+(in hand|under (?:his|her|their) arm|over (?:his|her|their|one) shoulder)\b/i.exec(after);
    const conf: Conf = notWorn ? "LOW" : ctx === "handle" || ((ctx === "none" || ctx === "comma") && np.possName && !bodyCtx && !inList) ? "MEDIUM" : "HIGH";
    emit(st, sent, attr, np.kind, notWorn ? `${text} (not worn)` : carried ? `${text} (carried ${carried[1].toLowerCase().replace(/\b(?:his|her|their|one)\b\s*/, "")})` : text, conf, at);
    if (ctx === "state") { const v = /\b(\w+(?: up)?)\s*$/.exec(s.slice(0, np.start)); if (v) condCue(st, sent, attr, `${np.written} ${pastOf(v[1])}`, at); }
  }
  for (const c of conds) { condCue(st, sent, attr, `${c} ${np.written}`, at); condNote(st, sent, attr, c, at); }
  if (pred) {
    condCue(st, sent, attr, `${np.written} ${pred.now ? "now " : ""}${pred.still ? "still " : ""}${pred.states}`, at);
    condNote(st, sent, attr, pred.states, at);
    if (pred.still) emit(st, sent, attr, "CONTINUITY", `Still ${pred.states} from earlier (carry-over)`, "HIGH", at);
  }
}
function pastOf(v: string): string {
  const irregular: Record<string, string> = { undoes: "undone", undo: "undone", unties: "untied", unzips: "unzipped", zips: "zipped", hitches: "hitched", rolls: "rolled", knots: "knotted", ties: "tied", tie: "tied", buttons: "buttoned", laces: "laced", buckles: "buckled", clasps: "clasped", fastens: "fastened", unclasps: "unclasped", unbuckles: "unbuckled" };
  const [first, ...rest] = v.toLowerCase().split(/\s+/); let p = irregular[first];
  if (!p) { const b = first.replace(/ing$/, "").replace(/(?<=[sxz]|ch|sh)es$/, "").replace(/s$/, ""); p = b.endsWith("e") ? b + "d" : b + "ed"; }
  return [p, ...rest].join(" ");
}

// ---------- special patterns (run before noun phrases) ----------
const PART_ALT = `${L.HEAD_ALT}|sleeves?|hems?|collars?|cuffs?|straps?|seams?|pallu|heels?|zips?|buttons?|lining|dupatta|odhni|chunni`;
const TEAR_V = "tears|tear|tore|rips|rip|ripped|snags|snagged|shreds|slashes|slashed|splits|split|snaps|snapped|catches|caught";
const tearState = (v: string, part: string) => { const w = v.toLowerCase(); const st = /^(?:tears|tear|tore|torn)$/.test(w) ? "torn" : /^rip/.test(w) ? "ripped" : /^snag/.test(w) ? "snagged" : /^snap/.test(w) || /gives way/.test(w) ? "broken" : /^catch|^caught/.test(w) ? "caught" : /^split/.test(w) ? "split" : /^shred|in shreds/.test(w) ? "shredded" : /in tatters/.test(w) ? "in tatters" : /^slash/.test(w) ? "slashed" : w; return st === "broken" ? `broken ${part}` : `${part} ${st}`; };
function scanSpecials(st: State, sent: Sent): void {
  const { s } = sent; let m: RegExpExecArray | null; const attrAt = (i: number) => subjectFor(st, sent, i);
  // "rips his shirt open" (tearA skips the "open" tail so the idiom path would only say "shirt open")
  const tearOpen = new RegExp(`\\b(${TEAR_V})\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${PART_ALT}))\\s+(?:wide\\s+)?open${L.B1}`, "gi");
  while ((m = tearOpen.exec(s))) { const a = ownerAttr(st, sent, m[2], m.index + m[0].indexOf(m[2])); condCue(st, sent, a, `${tearState(m[1], m[3].toLowerCase())} open`, m.index, "HIGH"); note(st, sent, a, "Damage", m[1], "repair, duplicates", "MEDIUM", m.index); use(sent, m.index, m.index + m[0].length); }
  const idiom = new RegExp(L.IDIOM_RE.source, "gi");
  while ((m = idiom.exec(s))) {
    if (L.overlaps(sent.spans, m.index, m.index + m[0].length) || L.overlaps(sent.used, m.index, m.index + m[0].length)) continue;
    const pre = s.slice(0, m.index);
    if (/\b(?:dog|cat|horse|pup|puppy|animal|pet|bottle|jar|car|door|jacket|coat)'s\s+$/i.test(pre)) continue; // "the dog's collar up"
    const ph = sent.names.find((h) => h.poss && justBefore(s, h, m!.index)); // "turns Raj's collar up"
    condCue(st, sent, ph ? named(ph.name) : attrAt(m.index), m[1].toLowerCase(), m.index); use(sent, m.index, m.index + m[0].length);
  }
  const state = new RegExp(`\\b(loosens?|loosening|tightens?|tightening|unbuttons?|unbuttoning|undoes|undoing|unzips?|rolls? up|rolling up|untucks?|hitches? up)\\s+(?:his|her|their|the)\\s+((?:(?:${L.MOD_ALT})\\s+)?(?:collar|sleeves?|cuffs?|hem|pallu|buttons?|straps?|laces|dupatta))${L.B1}`, "gi");
  while ((m = state.exec(s))) { const own = /\b(his|her|their)\b/i.exec(m[0]); condCue(st, sent, own ? resolvePronoun(st, sent, own[1], m.index + own.index) : attrAt(m.index), `${m[2].toLowerCase()} ${pastOf(m[1])}`, m.index); }
  // pallu / ghunghat over the head
  const pallu = /\b(?:pulls?|draws?|drapes?|takes?|tugs?|pulling|drawing|lifts?|throws?|flips?)\s+(his|her|their|the)\s+(pallu|dupatta|ghunghat|ghoonghat|veil|sari|saree|scarf|hood|shawl|odhni|chunni)\s+(?:up\s+)?over\s+(?:his|her|their)\s+(?:head|face|hair)\b|\bcovers?\s+(his|her|their)\s+(?:head|face)\s+with\s+(?:his|her|their|the)\s+(pallu|dupatta|ghunghat|veil|sari|saree|scarf|shawl|odhni|chunni)\b/gi;
  while ((m = pallu.exec(s))) { const own = m[1] || m[3]; const part = (m[2] || m[4]).toLowerCase(); const a = /^(his|her|their)$/i.test(own) ? resolvePronoun(st, sent, own, m.index) : attrAt(m.index); condCue(st, sent, a, `${part} over head (ghunghat)`, m.index, "HIGH"); use(sent, m.index, m.index + m[0].length); }
  // nudity / undress states. "naked truth", "naked eye" are idioms; "nude heels", "nude lipstick" is a colour.
  const towel = new RegExp(`\\b(in (?:a|just a) towel|towel-wrapped|wrapped in a towel|shirtless|bare-chested|topless|naked|nude|half-dressed|undressed|in (?:his|her|their) (?:underwear|boxers|briefs)|strip(?:s|ped)? (?:down )?to the waist|(?:bare|naked|stripped) to the waist|(?:^|,\\s*)shirt off|(?:has|with) (?:his|her|their) (?:shirt|top|kurta|t-shirt|vest) off)(?!\\s+(?:truth|eye|eyes|flame|ambition|aggression|greed|lie|lies|fear|power|self-interest|steel|blade|light|bulb|wire|wires|city|lunch|heels?|lipstick|lip|lips|shade|shades|tone|tones|colou?r|colou?red|pumps?|shoes?|tights|stockings|bra|make-?up|sandals?|palette|pink|beige|flats?|gloss|polish|photo|photos|photograph|scene|model|painting|sketch|(?:${L.HEAD_ALT})(?:es|s)?)\\b)(?![a-z-])`, "i").exec(s);
  if (towel && !L.overlaps(sent.spans, towel.index, towel.index + towel[0].length)) { const at = towel.index + towel[0].indexOf(towel[1]); const a = attrAt(at); const t = towel[1].toLowerCase().replace(/^,\s*/, ""); emit(st, sent, a, "GARMENT", /towel/.test(t) ? "Towel only" : /underwear|boxers|briefs/.test(t) ? "Underwear only" : /waist|shirt off|top off|kurta off|t-shirt off|vest off/.test(t) ? "Shirtless" : t, "HIGH", at); emit(st, sent, a, "NOTE", "Modesty: robe, closed set", "HIGH", at); use(sent, at, towel.index + towel[0].length); }
  const bare = L.BARE_FEET.exec(s); if (bare) { emit(st, sent, attrAt(bare.index), "ACCESSORY", "Barefoot (no footwear)", "HIGH", bare.index); use(sent, bare.index, bare.index + bare[0].length); }
  // absent items: hatless, "her mangalsutra is missing"
  const less = /\b(hatless|coatless|tieless|bare-?headed|sockless|beltless|gloveless|shirtless)\b/i.exec(s);
  if (less && !/shirtless/i.test(less[1])) { const w = less[1].toLowerCase(); const item = w.replace(/less$/, "").replace(/^bare-?headed$/, "hat"); emit(st, sent, attrAt(less.index), item === "coat" || item === "shirt" ? "GARMENT" : "ACCESSORY", `No ${item} (${w})`, "HIGH", less.index); use(sent, less.index, less.index + less[0].length); }
  const missing = new RegExp(`\\b(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}))(?:es|s)?\\s+(?:is|are|was|were)\\s+(?:missing|gone|absent|nowhere to be seen)${L.B1}`, "g");
  while ((m = missing.exec(s))) { const a = ownerAttr(st, sent, m[1], m.index); emit(st, sent, a, L.kindOfHead(L.canon(m[2].replace(/^.*\s/, ""))), `No ${m[2].toLowerCase()} (missing)`, "HIGH", m.index); use(sent, m.index, m.index + m[0].length); }
  const bloodHands = new RegExp(`\\b(?:(${L.OWNER})\\s+hands?\\s+(?:is|are)\\s+(?:bloody|bloodied|covered in blood|smeared with blood|red with blood)|blood on\\s+(${L.OWNER})\\s+hands?|(?:bloodied|bloody)\\s+hands?)${L.B1}`).exec(s);
  if (bloodHands) { const own = bloodHands[1] || bloodHands[2]; const a = own ? ownerAttr(st, sent, own, bloodHands.index + bloodHands[0].indexOf(own)) : attrAt(bloodHands.index); emit(st, sent, a, "NOTE", "Blood on hands: transfer risk to costume, duplicates", "HIGH", bloodHands.index, "hazard Blood"); use(sent, bloodHands.index, bloodHands.index + bloodHands[0].length); }
  const uni = /\b(out of (?:his |her |their )?uniform|back in uniform|in plain clothes|in civvies|in mufti)\b/i.exec(s);
  if (uni) { emit(st, sent, attrAt(uni.index), "CHANGE", /back in/i.test(uni[1]) ? "Back in uniform" : /plain|civvies|mufti/i.test(uni[1]) ? `Out of uniform (${uni[1].toLowerCase().replace(/^in /, "")})` : "Out of uniform", "HIGH", uni.index); use(sent, uni.index, uni.index + uni[0].length); }
  // continuity without a garment head
  const cont = /\b((?:hasn't|has not|hadn't|had not|never)\s+changed(?!\s+(?:the|his|her|their|a|its|much|at all|a bit|one bit|since (?:he|she|they)))|dressed as before|dressed the same as before|same as before|unchanged|still dressed the same)\b/i.exec(s);
  if (cont) {
    // bare "unchanged" / "same as before" / "hasn't changed" need a person or a garment as subject: "The plan is unchanged" is not wardrobe.
    const weak = !/dressed/i.test(cont[1]); const pre = s.slice(0, cont.index);
    const subjOk = !weak || new RegExp(`(?:\\b(?:he|she|they|clothes|clothing|outfit|look|costume|uniform|get-up|(?:${L.HEAD_ALT})(?:es|s)?)\\s+(?:(?:is|are|was|were|looks?|remains?|seems?|stays?)\\s+)?(?:still\\s+|exactly\\s+|much\\s+)?(?:the\\s+)?|,\\s*)$`, "i").test(pre) || sent.names.some((h) => !h.poss && /^\s+(?:(?:is|are|was|were|looks?|remains?|seems?|stays?)\s+)?(?:still\s+|exactly\s+)?(?:the\s+)?$/i.test(s.slice(h.end, cont!.index)));
    if (subjOk) { emit(st, sent, attrAt(cont.index), "CONTINUITY", `Same clothes as earlier (${cont[1].toLowerCase()})`, "HIGH", cont.index); use(sent, cont.index, cont.index + cont[0].length); }
  }
  // continuity by reference to an earlier event or scene: "dressed as he was at the wedding", "dressed exactly as in the previous scene", "wears what he wore at the funeral"
  const ref = /\b(?:dressed\s+(?:exactly\s+|just\s+)?as\s+(?:he|she|they)\s+(?:was|were)\s+(?:at|in|for|during)\s+(?:the\s+)?(\w+(?:\s\w+)?)|dressed\s+(?:exactly\s+|just\s+)?as\s+in\s+(?:the\s+)?(previous scene|earlier scene|last scene|scene\s+\d+|sc\.?\s*\d+)|wears?\s+(?:exactly\s+)?what\s+(?:he|she|they)\s+(?:wore|had on|was wearing|were wearing)\s+(?:at|in|for|to|during)\s+(?:the\s+)?(\w+(?:\s\w+)?))/i.exec(s);
  if (ref) { const evn = (ref[1] || ref[3] || "").toLowerCase().replace(/\s+(?:and|but|when|where|before|after|last|earlier|yesterday)$/, ""); const txt = ref[2] ? `Same as ${ref[2].toLowerCase().replace(/^sc\.?\s*/, "scene ")}` : `Same clothes as the ${evn}`; emit(st, sent, attrAt(ref.index), "CONTINUITY", `${txt} (carry-over)`, "HIGH", ref.index); use(sent, ref.index, ref.index + ref[0].length); }
  const changed = /\b(gets? changed|got changed|gets? dressed|get dressed|gets? undressed|freshens up and changes|changes (?:quickly|fast|in a hurry|behind the))\b/i.exec(s);
  if (changed) { emit(st, sent, attrAt(changed.index), "CHANGE", `${L.cap(changed[1].toLowerCase())} (new outfit)`, "HIGH", changed.index); use(sent, changed.index, changed.index + changed[0].length); }
  const role = /\b(dressed (?:up )?as|disguised as|posing as|in costume as)\s+(?!(?:before|earlier|usual|always|ever|yesterday|in scene|in sc|he|she|they|if|though)\b)(?:a|an|the)?\s*((?:[a-z]+\s?){1,3}?)(?=[,.;]|\s+(?:and|in|with|who)\b|$)/gi;
  while ((m = role.exec(s))) { const a = attrAt(m.index); const r = m[2].trim().toLowerCase(); emit(st, sent, { ...a, chars: a.chars.filter((c) => c.toLowerCase() !== r) }, "GARMENT", `${/disguised|posing/i.test(m[1]) ? "Disguise" : "Dressed as"}: ${r}`, "HIGH", m.index); use(sent, m.index, m.index + m[0].length); }
  // colour-only outfits: "dressed in black", "a heavyset man in khaki", "in white from head to toe"
  const col = new RegExp(`\\b(?:dressed in|clad in|wearing|wears|all in|(?:[a-z']+|[A-Z][A-Za-z'-]*)\\s+(?<!\\b(?:paid|bathed|bathes|covered|written|printed|dipped|painted|drenched|soaked|steeped|cast|lit|glowing|wrapped|set|shrouded|draped|framed|edged|trimmed|glows|bathing|writes?|wrote|writing|pays?|paying|trades?|traded|trading|deals?|dealt|dealing|signs?|signed|speaks?|spoke|invests?|invested|works?|worked|specialises?|specializes?|majors?|believes?|thinks?|sees?|saw|talks?|drowns?|swims?|prints?|marks?|circles?|underlines?|highlights?|draws?|drew|paints?|colours?|inks?|types?|scrawls?|scribbles?|fills?|outlines?|answers?|replies|counts?|measures?|values?|quotes?|charges?|bills?|settles?|sells?|sold|buys?|bought|purchases?|bids?|offers?|cash|money|payment|stock|shares|debt|glistens?|shimmers?|sparkles?|flashes|blazes?|burns?|flickers?|shines?|shone|gleams?|lands?|ends?|finishes|results?|puts?|plays?|played|bets?|deep|knee-deep|ankle-deep|waist-deep|drips?|dripping|dyed|dyes?|stains?|stained|smeared|streaked|spattered|splashed|blooms?|blossoms?|explodes?|erupts?|swimming|drowning|bathing|swim|written|inscribed|engraved|etched|embossed|decorated|rendered|shot|filmed|photographed|marked|highlighted|underlined|circled)\\s+)in)\\s+(khaki|black|white|saffron|navy|grey|gray|red|blue|green|pink|yellow|cream|ivory|brown|purple|orange|gold|silver|denim|leather|silk|linen|tweed|camouflage|khakis|whites|blacks|pastels|widow's white|mourning white)(\\s+(?:from\\s+)?(?:head to toe|top to toe|head to foot))?(?=[,.;!?]|\\s+(?:and(?!\\s+white)|with|who|enters|exits|waits|stands|sits|walks|arrives|leaves|steps|watches|looks|smiles|nods)\\b|$)`, "g");
  while ((m = col.exec(s))) {
    if (L.overlaps(sent.spans, m.index, m.index + m[0].length)) continue;
    const at = m.index + m[0].indexOf(m[1]); const txt = `Dressed in ${m[1].toLowerCase()}${m[2] ? " head to toe" : ""}`;
    if (/\b(?:both|all|everyone|everybody|they|the (?:men|women|guests|mourners|family|children))\b/i.test(s.slice(0, at)) && !sent.names.some((h) => !h.poss && h.end <= at)) emit(st, sent, NONE, "NOTE", `Everyone in ${m[1].toLowerCase()} (${/both/i.test(s) ? "both" : "all"})`, "MEDIUM", at);
    else { const a = attrAt(at); if (a.chars.length || a.prefix) emit(st, sent, a, "GARMENT", txt, "HIGH", at); }
    use(sent, at, m.index + m[0].length);
  }
  const sling = /\b(?:(his|her|their)\s+)?(arm|leg|wrist|hand|foot)\s+(?:is\s+)?in\s+a\s+(sling|cast|plaster|splint)\b/i.exec(s);
  if (sling) { emit(st, sent, sling[1] ? resolvePronoun(st, sent, sling[1], sling.index) : attrAt(sling.index), "NOTE", `${L.cap(sling[2].toLowerCase())} in a ${sling[3].toLowerCase()}: sleeve allowance`, "HIGH", sling.index); use(sent, sling.index, sling.index + sling[0].length); }
  const preg = /\b(?:(\w+) months? )?pregnant(?!\s+(?:pause|silence|moment|question|phrase|look|stillness|with|hush|beat))\b|\bbaby bump\b/i.exec(s); if (preg) emit(st, sent, attrAt(preg.index), "NOTE", `Pregnant${preg[1] ? ` (${preg[1].toLowerCase()} months)` : ""}: pregnancy pad, adjusted fit`, "HIGH", preg.index);
  // "an older Raj", "A YOUNGER RAJ (12)": the age word must introduce a character (name hit or caps intro), not a brand or place ("the older Mercedes").
  const ageRe = /\b(?:an?\s+|the\s+)?(older|younger)\s+(?=[A-Z])/gi;
  while ((m = ageRe.exec(s)) && !sent.depict) {
    const at = m.index + m[0].length; const h = sent.names.find((x) => x.start === at && !x.poss);
    const capsIntro = !h && /^[A-Z][A-Z'-]{2,}(?:\s|\(|,|$)/.test(s.slice(at)) && !L.SFX.has(/^[A-Z'-]+/.exec(s.slice(at))![0]);
    if (!h && !capsIntro) continue;
    emit(st, sent, h ? named(h.name) : attrAt(m.index), "NOTE", L.AGE_TEXT(m[1]), "HIGH", m.index); break;
  }
  const age2 = /,\s*(older|younger)(?:\s+now)?\s*,/i.exec(s); if (age2 && !sent.depict) emit(st, sent, attrAt(age2.index), "NOTE", L.AGE_TEXT(age2[1]), "HIGH", age2.index);
  // stunt doubles: "stunt double", "Raj's double does the jump", "a stunt double takes the fall for Vikram". Not "orders a double", "sees double".
  const stunt = /\b(?:stunt|body|photo|stand-in)\s+double\b|\b(?:his|her|their|[A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?'s)\s+double\s+(?=(?:does|takes|performs|steps|stands|goes|makes|handles|is)\b)|\bdouble\s+(?:does|takes|performs)\s+the\s+(?:jump|fall|stunt|leap|dive|crash|scene|shot|drop|roll|tumble)\b/i.exec(s);
  if (stunt && !L.overlaps(sent.spans, stunt.index, stunt.index + stunt[0].length)) {
    const dAt = stunt.index + stunt[0].toLowerCase().indexOf("double");
    const own = /\b(his|her|their)\s+$/i.exec(s.slice(0, dAt).replace(/\b(?:stunt|body|photo|stand-in)\s+$/i, "")); const ph = sent.names.find((h) => h.poss && (justBefore(s, h, dAt) || justBefore(s, h, stunt!.index)));
    const forWho = /\b(?:for|as|doubling for|standing in for)\s+(?=([A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?|him|her))/.exec(s.slice(dAt)); const fw = forWho ? personAt(st, sent, dAt + forWho.index + forWho[0].length) : null;
    emit(st, sent, ph ? named(ph.name) : own ? resolvePronoun(st, sent, own[1], own.index) : fw && fw.chars.length ? fw : attrAt(stunt.index), "NOTE", "Stunt double: matching duplicate costume", "HIGH", stunt.index); use(sent, stunt.index, stunt.index + stunt[0].length);
  }
  const fit = /\b(?:measures|is measured|being measured|fits|fitted|tailors|alters)\s+(?:([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+)?)\s+)?for\s+(?:a|an|the|his|her)?\s*/g;
  while ((m = fit.exec(s))) { const np = findNPs(sent).find((n) => n.headStart >= m!.index + m![0].length - 1 && n.headStart <= m!.index + m![0].length + 1); if (!np) continue; const who = m[1] ? sent.names.find((h) => !h.poss && h.start === m!.index + m![0].indexOf(m![1])) : undefined; emit(st, sent, who ? named(who.name) : attrAt(m.index), "NOTE", `Fitting: ${npText(np)} being tailored (not worn yet)`, "MEDIUM", m.index); use(sent, np.start, np.end); }
  const setd = /\b(rows|racks|bolts|piles|stacks) of\s+(\w+(?:\s\w+)?)/i.exec(s); if (setd) use(sent, setd.index, setd.index + setd[0].length);
  // someone pushed / shoved into water: the person going in gets the note
  const dunk = /\b(?:pushes|shoves|throws|drags|pulls|dunks|tips|knocks|flings|hurls)\s+([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+)?|him|her|them)\s+(?:in|into|under|off the \w+ into|over the side into)\s+(?:the |a )?(river|lake|sea|ocean|pool|water|waterfall|fountain|canal|well|tank|waves|swimming pool)\b/g;
  while ((m = dunk.exec(s))) { const at = m.index + m[0].indexOf(m[1]); const subj = attrAt(m.index); const who = personAt(st, sent, at, subj.chars); if (who) note(st, sent, who, "Water immersion", `pushed into ${m[2]}`, "duplicates, wet set, warm robe", "MEDIUM", m.index); }
}
/** Note + condition for the person something wet or messy was thrown at. `at` is the victim token position. */
function throwNote(st: State, sent: Sent, subRaw: string, at: number, matchAt: number, subj: Attr): void {
  const victim = personAt(st, sent, at, subj.chars); if (!victim || victim.chars.some((c) => subj.chars.includes(c))) return;
  const sub = subRaw.toLowerCase().replace(/s$/, "").replace(/^(?:glass|cup|mug|jug|pitcher)$/, "drink").replace(/^bucket$/, "water");
  const water = /^(?:water|bucket|pani|rain|snow)$/.test(sub); const food = /^(?:cake|pie|cream pie|curry|dal|sauce|gravy|ketchup|ice cream|soup|flour|plate|bowl)$/.test(sub);
  const f = L.hazardFamilyFor(sub);
  if (water) { condCue(st, sent, victim, "drenched (water thrown)", matchAt); note(st, sent, victim, "Rain/water", sub, "wet costumes, duplicates, drying", "MEDIUM", matchAt); }
  else if (f != null) { condCue(st, sent, victim, `${sub}-stained`, matchAt); note(st, sent, victim, L.HAZARDS[f][0], sub, L.HAZARDS[f][2], "MEDIUM", matchAt); }
  else if (food) { condCue(st, sent, victim, `${sub} smashed on (stained)`, matchAt); emit(st, sent, victim, "NOTE", `Food (${sub}): stain, duplicates, cleaning`, "MEDIUM", matchAt, "hazard food thrown"); }
  else { condCue(st, sent, victim, `${sub} thrown over (wet, stained)`, matchAt); emit(st, sent, victim, "NOTE", `Spill (${sub}): stain, duplicates, cleaning`, "MEDIUM", matchAt, "hazard spill thrown"); }
}
function scanStains(st: State, sent: Sent): void {
  const { s } = sent; let m: RegExpExecArray | null;
  const owner = (o: string, at: number) => ownerAttr(st, sent, o, at);
  const blood = new RegExp(L.BLOOD_RE.source, "gi");
  while ((m = blood.exec(s))) { const a = owner(m[1], m.index + m[0].lastIndexOf(m[1])); condCue(st, sent, a, `blood on ${m[2].toLowerCase()}`, m.index); note(st, sent, a, "Blood", "blood", "duplicates, blood prep", "HIGH", m.index); }
  const stain = new RegExp(L.STAIN_RE.source, "gi");
  while ((m = stain.exec(s))) { const a = owner(m[2], m.index + m[0].lastIndexOf(m[2])); condCue(st, sent, a, `${m[1].toLowerCase()} stain on ${m[3].toLowerCase()}`, m.index); }
  const spill = new RegExp(L.SPILL_RE.source, "gi");
  while ((m = spill.exec(s))) { const a = owner(m[2], m.index + m[0].lastIndexOf(m[2])); const sub = m[1].toLowerCase(); condCue(st, sent, a, `${sub} spilled down ${m[3].toLowerCase()}`, m.index); emit(st, sent, a, "NOTE", `Spill (${sub}): stain, duplicates, cleaning`, "MEDIUM", m.index); }
  // "smear haldi on Raj's face and kurta"
  const smear = new RegExp(`\\b(?:smears?|rubs?|throws?|flings?|dabs?|splashes|sprays?|dumps?|daubs?|smearing|rubbing|wipes?)\\s+(?:the\\s+)?(haldi|gulal|colour|colours|turmeric|paint|mud|mehendi|henna|cake|cream|foam|ink|soot|ash|grease|oil|blood|flour|sindoor)\\s+(?:on|onto|over|across|all over|into|down)\\s+(${L.OWNER})\\s+(?:(?:face|hair|cheeks?|forehead|hands?|arms?|neck|head|chest|nose)\\s+and\\s+)?((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}|${L.PARTS}))${L.B1}`, "gi");
  while ((m = smear.exec(s))) { const a = owner(m[2], m.index + m[0].indexOf(m[2], m[0].indexOf(m[1]) + m[1].length)); const sub = m[1].toLowerCase(); condCue(st, sent, a, `${sub}-stained ${m[3].toLowerCase()}`, m.index); const f = L.hazardFamilyFor(sub); if (f != null) note(st, sent, a, L.HAZARDS[f][0], sub, L.HAZARDS[f][2], "MEDIUM", m.index); else emit(st, sent, a, "NOTE", `Spill (${sub}): stain, duplicates, cleaning`, "MEDIUM", m.index); }
  // blood or a substance landing on someone else's garment with no preposition: "blood spatters Vikram's white shirt"
  const bloodHit = new RegExp(`\\b(?:blood|bleeds?|bleeding)\\b[^.;]{0,40}?\\b(spatters|splatters|soaks|stains|drenches|covers|sprays|streaks|smears|flecks|speckles)\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}|${L.PARTS}))${L.B1}`, "gi");
  while ((m = bloodHit.exec(s))) { const a = owner(m[2], m.index + m[0].lastIndexOf(m[2])); condCue(st, sent, a, `blood-${/soak|drench/.test(m[1]) ? "soaked" : "spattered"} ${m[3].toLowerCase()}`, m.index); note(st, sent, a, "Blood", "blood", "duplicates, blood prep", "HIGH", m.index); }
  const cov = new RegExp(L.COVERED_RE.source, "gi");
  while ((m = cov.exec(s))) {
    let a = subjectFor(st, sent, m.index); const sub = m[3].toLowerCase();
    // "Raj's shirt is soaked with blood": the noun-phrase path owns a garment subject (condition + note), so do not emit twice
    const headSubj = new RegExp(`(?:${L.HEAD_ALT})(?:es|s)?\\s+(?:is|are|was|were|now|still|gets|got)?\\s*$`, "i").exec(s.slice(0, m.index));
    if (headSubj && condPredicate(s, headSubj.index + headSubj[0].replace(/\s+(?:is|are|was|were|now|still|gets|got)?\s*$/i, "").length)) continue;
    if (a.via === "unknown" && /'s /.test(a.prefix)) continue; // "Priya's desk is covered in dust": set dressing, not costume
    if (!SUBJECT_VIAS.has(a.via) || /^\s*(?:it|its|the|a|an|this|that|these|those|everything|every)\s+(?!(?:his|her|their|inspector|constable)\b)[a-z]/i.test(s.slice(0, m.index)) && !sent.names.some((h) => h.end <= m!.index)) a = NONE; // set dressing: "The walls are covered in dust", "It is spattered with mud"
    if (a.chars.length || a.prefix) condCue(st, sent, a, `${m[1].toLowerCase()} in ${(m[2] || "").toLowerCase()}${sub}`, m.index);
    const f = L.hazardFamilyFor(sub); if (f != null) note(st, sent, a, L.HAZARDS[f][0], m[1], L.HAZARDS[f][2], a.chars.length ? "MEDIUM" : "LOW", m.index); else if (a.chars.length) emit(st, sent, a, "NOTE", `Spill (${sub}): stain, duplicates, cleaning`, "MEDIUM", m.index);
  }
  // "Priya's white salwar is pink with gulal", "his kurta is streaked with paint"
  const colourWith = new RegExp(`\\b(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}|${L.PARTS}))(?:es|s)?\\s+(?:is|are|was|were)\\s+(?:now\\s+|all\\s+)?(?:pink|red|green|yellow|blue|purple|orange|streaked|splashed|smeared|stained|caked|plastered|bright|wet|dark|heavy|sticky)\\s+(?:with|in)\\s+(${L.SUBS})${L.B1}`, "gi");
  while ((m = colourWith.exec(s))) { const a = owner(m[1], m.index); const sub = m[3].toLowerCase(); condCue(st, sent, a, `${sub}-stained ${m[2].toLowerCase()}`, m.index); const f = L.hazardFamilyFor(sub); if (f != null) note(st, sent, a, L.HAZARDS[f][0], sub, L.HAZARDS[f][2], "MEDIUM", m.index); else emit(st, sent, a, "NOTE", `Spill (${sub}): stain, duplicates, cleaning`, "MEDIUM", m.index); use(sent, m.index + m[0].length - m[3].length, m.index + m[0].length); }
  // vomit: "vomits on his shoes", "throws up down his shirt"
  const vomit = new RegExp(`\\b(?:vomits?|pukes?|throws up|retches|is sick)\\s+(?:on|onto|down|over|all over|into|across)\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}|${L.PARTS})(?:es|s)?)${L.B1}`, "gi");
  while ((m = vomit.exec(s))) { const a = owner(m[1], m.index + m[0].indexOf(m[1])); condCue(st, sent, a, `vomit-stained ${m[2].toLowerCase()}`, m.index); emit(st, sent, a, "NOTE", "Spill (vomit): duplicates, cleaning", "MEDIUM", m.index); }
  // liquids, food or water thrown at a person with no garment noun: "throws her drink in Raj's face", "empties a bucket over Priya's head", "drenches Vikram with a hose"
  const thrown = new RegExp(`\\b(?:throws?|flings?|hurls?|tosses|tips|empties|dumps?|pours?|splashes|chucks?|smashes|shoves|pushes|upends)\\s+(?:(?:his|her|their|a|an|the|another|two|some|whole)\\s+)?(?:(?:glass|cup|mug|bucket|bottle|jug|pail|pot|bowl|plate|tray|pitcher|carafe|can)(?:ful)?\\s+of\\s+)?(${L.SUBS}|drinks?|cocktail|soup|lassi|thandai|bucket|glass|cup|mug|jug|pitcher|pie|bowl|plate|cream pie|champagne|soda|cola|lemonade|sharbat|pani|water)\\b[^.;]{0,30}?\\b(?:at|in|into|over|on|onto|all over|across|down)\\s+(${L.OWNER.replace(/'s$/, "")}(?:'s)?|him|her|them)(?=\\s+(?:face|head|hair|chest|back|lap|front|neck|shoulders?)\\b|[,.;!?]|\\s+(?:and|as|then|before|while)\\b|$)`, "g");
  while ((m = thrown.exec(s))) { if (L.overlaps(sent.spans, m.index, m.index + m[0].length)) continue; throwNote(st, sent, m[1], m.index + m[0].lastIndexOf(m[2]), m.index, subjectFor(st, sent, m.index)); }
  const thrownPassive = new RegExp(`\\b(${L.SUBS}|drinks?|cocktail|soup|bucket of water|bucket|glass of water|glass of wine|pie|cream pie|water)\\s+(?:is|are|gets|get)\\s+(?:smashed|thrown|flung|hurled|tipped|poured|dumped|splashed|emptied|pushed|shoved|smeared)\\s+(?:at|in|into|over|on|onto|all over|across|down)\\s+(${L.OWNER.replace(/'s$/, "")}(?:'s)?|him|her|them)(?=\\s+(?:face|head|hair|chest|back|lap|front|neck|shoulders?)\\b|[,.;!?]|\\s+(?:and|as|then|before|while)\\b|$)`, "g");
  while ((m = thrownPassive.exec(s))) { if (L.overlaps(sent.spans, m.index, m.index + m[0].length)) continue; throwNote(st, sent, m[1], m.index + m[0].lastIndexOf(m[2]), m.index, NONE); }
  const drench = /\b(?:drenches|soaks|douses|dunks|hoses(?: down)?)\s+([A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?|him|her|them)\b(?:\s+(to the skin|through|from head to toe|with (?:a |the )?(?:hose|hosepipe|bucket|water|champagne|beer|jug)))?|\b(?:sprays|showers|splashes|squirts)\s+([A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?|him|her|them)\s+with\s+(?:a |the )?(?:hose|hosepipe|water|champagne|beer|bucket|jug|water gun|water pistol|pichkari|colour|colours|gulal)\b/g;
  while ((m = drench.exec(s))) {
    if (L.overlaps(sent.spans, m.index, m.index + m[0].length)) continue;
    const nameTok = m[1] || m[3]; const at = m.index + m[0].indexOf(nameTok, m[0].search(/\s/)); const subj = subjectFor(st, sent, m.index); const who = personAt(st, sent, at, subj.chars);
    if (!who) continue; const colour = /gulal|colou?r/i.test(m[0]);
    condCue(st, sent, who, colour ? "colour-drenched" : `soaked${m[2] && /skin|through|head/.test(m[2]) ? ` ${m[2].toLowerCase()}` : ""}`, m.index);
    note(st, sent, who, colour ? "Holi/colour" : "Rain/water", colour ? "colour" : "drenched", colour ? "colour-fast duplicates, everyone stained" : "wet costumes, duplicates, drying", "MEDIUM", m.index);
  }
  // sweat
  const sweat1 = new RegExp(`\\bsweat(?:s|ing|ed)\\s+through\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}))${L.B1}|\\bsweat\\s+(?:stains|soaks|darkens|patches|marks|drenches)\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}))${L.B1}`, "gi");
  while ((m = sweat1.exec(s))) { const o = m[1] || m[3]; const g = (m[2] || m[4]).toLowerCase(); const a = owner(o, m.index + m[0].lastIndexOf(o, m[0].lastIndexOf(g))); condCue(st, sent, a, `${m[1] ? "sweat-soaked" : "sweat-stained"} ${g}`, m.index); note(st, sent, a, "Sweat", "sweat", "spare shirts", "MEDIUM", m.index); }
  const cling = new RegExp(`\\b((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}))(?:es|s)?\\s+(?:clings|clinging|plastered|stuck|sticking)\\s+(?:wetly\\s+)?to\\s+(?:him|her|them|his|her|their)\\b`, "gi");
  while ((m = cling.exec(s))) { const a = subjectFor(st, sent, m.index); condCue(st, sent, a, `wet ${m[1].toLowerCase()}, clinging`, m.index); note(st, sent, a, "Rain/water", "clinging", "wet costumes, duplicates, drying", "MEDIUM", m.index); }
  const wring = new RegExp(`\\bwrings?\\s+(?:out\\s+)?(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${L.HEAD_ALT}))(?:es|s)?(?:\\s+out)?${L.B1}`, "gi");
  while ((m = wring.exec(s))) { const a = owner(m[1], m.index + m[0].indexOf(m[1])); condCue(st, sent, a, `wet ${m[2].toLowerCase()} (wrung out)`, m.index); note(st, sent, a, "Rain/water", "wrung out", "wet costumes, duplicates, drying", "MEDIUM", m.index); }
  // torn / ripped / snapped garments and parts
  const tearA = new RegExp(`\\b(${TEAR_V})\\s+(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${PART_ALT}))${L.B1}(?!\\s+(?:off|open|away|from|out))`, "gi");
  while ((m = tearA.exec(s))) { const a = owner(m[2], m.index + m[0].indexOf(m[2])); const part = m[3].toLowerCase(); condCue(st, sent, a, tearState(m[1], part), m.index, "HIGH"); note(st, sent, a, "Damage", m[1], "repair, duplicates", "MEDIUM", m.index); }
  const tearB = new RegExp(`\\b(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${PART_ALT}))\\s+(?:(?:is|are|was|were|gets|now|still)\\s+)?(torn|ripped|tears|rips|snags|snagged|splits|split|catches on|snaps|snapped|gives way|shreds|in shreds|in tatters|slashed)${L.B1}(?:\\s+(?:at|on|along|across|down)\\s+the\\s+(\\w+))?`, "gi");
  while ((m = tearB.exec(s))) { const a = owner(m[1], m.index); const part = m[2].toLowerCase(); condCue(st, sent, a, `${tearState(m[3], part)}${m[4] ? ` at ${m[4].toLowerCase()}` : ""}`, m.index, "HIGH"); note(st, sent, a, "Damage", m[3], "repair, duplicates", "MEDIUM", m.index); }
  // garment on fire
  const fire = new RegExp(`\\b(${L.OWNER})\\s+((?:(?:${L.MOD_ALT})\\s+)*(?:${PART_ALT}))\\s+(catches fire|catches alight|goes up in flames|is on fire|bursts into flames|burns|is burning|smoulders|is singed|is scorched|is burnt|singes|scorches)${L.B1}`, "gi");
  while ((m = fire.exec(s))) { const a = owner(m[1], m.index); condCue(st, sent, a, `${m[2].toLowerCase()} burnt/singed`, m.index, "HIGH"); note(st, sent, a, "Fire/smoke", m[3], "FR duplicates, burnt breakdown", "HIGH", m.index); }
  // bare condition predicates and appositives: "Raj is soaked to the skin", "Priya, dripping wet, glares", "(wet, muddy)"
  const bc = new RegExp(L.BARE_COND_RE.source, "gi"); const headBefore = new RegExp(`(?:${L.HEAD_ALT})(?:es|s)?\\s*$`, "i");
  const npSpans: L.Span[] = findNPs(sent).map((n) => [n.start, n.end]);
  while ((m = bc.exec(s))) {
    const at = m.index + m[0].lastIndexOf(m[1]); if (L.overlaps(sent.spans, at, at + m[1].length) || L.overlaps(sent.used, at, at + m[1].length) || L.overlaps(npSpans, at, at + m[1].length)) continue;
    if (headBefore.test(s.slice(0, m.index).replace(/\s+(?:is|are|was|were|looks?|hangs|now|still|clings|hanging)\s*$/i, ""))) continue; // "his shirt is soaked" is handled by the noun-phrase path
    if (/\b(?:hair|face|eyes|cheeks|forehead|skin|floor|road|street|ground|grass|walls?|windows?|glass|table|sheets?|towel)\s+(?:is|are|was|were|now|still|looks?)?\s*$/i.test(s.slice(0, m.index))) continue;
    const a = subjectFor(st, sent, at); if (!SUBJECT_VIAS.has(a.via)) continue;
    const cond = m[1].toLowerCase(); condCue(st, sent, a, cond, at, sent.kind === "paren" ? "HIGH" : "MEDIUM"); condNote(st, sent, a, cond, at);
  }
}
const EVENT_TALK_RE = /\b(?:next|last|this coming|the following|the coming)\s+(?:year|month|week|spring|summer|winter|autumn|season|weekend|time|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:tomorrow|yesterday|ago|was|were|will|would|had|has been|have been|plans?|planning|planned|postpone[sd]?|cancel(?:led|s)?|called off|invitation|invited|invites?|remembers?|recalls?|talks? about|says|said|discuss(?:es)?|mentions?|dreads?|looks? forward|looking forward|wore|dressed as)\b/i;
function scanCrowdAndHazards(st: State, sent: Sent): void {
  const { s } = sent; let m: RegExpExecArray | null;
  const counted = new RegExp(L.COUNTED_RE.source, "gi");
  while ((m = counted.exec(s))) { if (/^\d+$/.test(m[1]) && Number(m[1]) < 3) continue; emit(st, sent, NONE, "NOTE", `Background: ${m[1].toLowerCase()} ${m[2].toLowerCase()}${m[3] ? ` in ${m[3].toLowerCase()}` : ""}`, "MEDIUM", m.index); use(sent, m.index, m.index + m[0].length); }
  const uni = new RegExp(L.UNI_RE.source, "gi");
  while ((m = uni.exec(s))) { if (!L.overlaps(sent.used, m.index, m.index + m[0].length)) emit(st, sent, NONE, "NOTE", `Uniforms: ${m[1].toLowerCase()} in ${m[2].toLowerCase()}`, "MEDIUM", m.index); use(sent, m.index, m.index + m[0].length); }
  const coll = L.COLLECTIVE_RE.exec(s);
  if (coll && !L.overlaps(sent.used, coll.index, coll.index + coll[0].length) && !(coll[1].toLowerCase() === "mob" && !/(?:angry|hostile|restless|jeering|baying|lynch|violent|rioting|drunken|furious)\s+mob|mob\s+(?:of|gathers|surges|storms|swarms|forms|chases|surrounds|attacks|descends|rushes|jeers|roars|erupts|closes in|breaks|throws|hurls|pelts)/i.test(s)))
    emit(st, sent, NONE, "NOTE", `Background: ${coll[1].toLowerCase()}${coll[2] ? ` of ${coll[2].toLowerCase()}` : ""}`, "MEDIUM", coll.index);
  // an event only matters when it is happening in this scene: "plans the wedding for next year", "the funeral was last spring" are talk
  const ev = L.EVENT_RE.exec(s); if (ev && !L.overlaps(sent.spans, ev.index, ev.index + ev[0].length) && !EVENT_TALK_RE.test(s)) emit(st, sent, NONE, "NOTE", `Event: ${ev[1].toLowerCase()} - ceremonial/formal wardrobe for all`, "MEDIUM", ev.index);
  const namedHits = L.uniq(sent.names.filter((h) => !h.poss).map((h) => h.name));
  let subj: Attr = namedHits.length ? { chars: namedHits, conf: "MEDIUM", prefix: "", via: "name" } : NONE;
  if (!namedHits.length) { const pr = /\b(he|she|they|his|her|their)\b/i.exec(s); if (pr) subj = resolvePronoun(st, sent, pr[1], pr.index); }
  let setDressing = false;
  if (!subj.chars.length) {
    const ph = sent.names.find((h) => h.poss);
    if (ph) {
      // "Priya's desk is covered in dust", "Raj's car is covered in mud": a possessed object, not the person's costume
      const nm = POSS_NOUN_RE.exec(s.slice(ph.end)); const noun = nm?.[1].toLowerCase();
      if (noun && !POSS_SELF_RE.test(noun) && !new RegExp(`^(?:${L.HEAD_ALT})$`, "i").test(L.canon(noun)) && !PART_WORD_RE.test(noun)) setDressing = true;
      else subj = { chars: [ph.name], conf: "MEDIUM", prefix: "", via: "name" };
    }
  }
  if (sent.kind === "paren" && sent.speaker) subj = { chars: [sent.speaker], conf: "HIGH", prefix: "", via: "speaker" };
  for (const h of sent.names) { // "shoves Raj", "punches Dev": a violence verb right before a character name
    if (h.poss) continue; const v = L.VIOLENCE_BEFORE_NAME_RE.exec(s.slice(0, h.start)); if (!v || L.overlaps(sent.spans, v.index, h.end) || /^\s+a\s+(?:look|glance|glare|smile|grin)\b/i.test(s.slice(h.end))) continue;
    if (/\b(?:air|wind|breeze|light|sunlight|heat|smell|stench|realisation|realization|thought|news|truth|silence|music|noise|cold|chill|draught|draft|it|this|that|ball|car|bus|truck|bullet|wave|door|rain|water|spray|sun|glare)\s+\w+\s*$/i.test(s.slice(0, v.index)) && /^hits$/i.test(v[1])) continue; // "a blast of cold air hits Raj"
    note(st, sent, subj.chars.length ? { ...subj, prefix: "" } : NONE, "Fight/violence", `${v[1]} ${h.name}`, "tears, dirt, blood risk, duplicates", "LOW", v.index); break;
  }
  L.HAZARDS.forEach(([family, , consequence, scope], i) => {
    const h = L.HAZARD_RES[i].exec(s); if (!h || L.overlaps(sent.spans, h.index, h.index + h[0].length) || /^[A-Z!.]+$/.test(h[0])) return;
    if (setDressing && scope === "subject") return;
    if (scope === "scene" || !subj.chars.length) note(st, sent, NONE, family, h[0], consequence, "LOW", h.index);
    else note(st, sent, { ...subj, prefix: "" }, family, h[0], consequence, "LOW", h.index);
  });
}

// ---------- action, dialogue, slug ----------
function detectIntro(st: State, sent: Sent): void {
  const { s } = sent; let at = 0; let attr: Attr | null = null;
  // consume a leading article and/or age word ("A WAITER", "An older RAJ") so a named character introduced with an article still matches by name
  const lead = /^(?:(?:An?|The)\s+)?(?:(?:older|younger|young|old|little)\s+)?/i.exec(s); if (lead) at = lead[0].length;
  const hit = sent.names.find((h) => h.start === at && !h.poss);
  if (hit) { attr = { chars: coord(sent, hit), conf: "HIGH", prefix: "", via: "name" }; at = hit.end; const and = sent.names.find((h) => !h.poss && /^\s+and\s+$/.test(s.slice(hit.end, h.start))); if (and) at = and.end; }
  else { const m = /^(?:(?:A|AN|THE)\s+)?((?:[A-Z][A-Z'-]+\s?){1,3})(?=\s*[(,]| in\b| wears\b)/.exec(s.slice(at)); if (!m || m[1].trim().split(" ").some((w) => L.SFX.has(w))) return; attr = { chars: [], conf: "MEDIUM", prefix: L.title(m[1].trim()) + ": ", via: "unknown" }; at += m[0].length; }
  const age = /^\s*(?:\(\d{1,3}[^)]*\)|,\s*(?:\d{1,3}|twelve|ten|eight|six|sixteen|seventeen|eighteen)\s*(?=,))/.exec(s.slice(at)); if (age) at += age[0].length;
  if (!/^\s*(?:,|\bin\b|\bwears\b|\bwearing\b|\bdressed\b)/.test(s.slice(at))) return;
  const frags = s.slice(at).split(","); let pos = at; let end = at;
  for (let i = 0; i < frags.length; i++) {
    const f = frags[i]; const start = pos; pos += f.length + 1;
    if (L.FINITE_RE.test(f) && !(i === 0 && /\b(?:in|wearing|wears|dressed)\b/i.test(f))) { if (i === 0 && /\b(?:in|wearing|wears|dressed)\b/i.test(f)) end = start + f.length; break; }
    end = start + f.length;
  }
  // a second, non-possessive character inside the range starts their own clause: "Raj wears a kurta and Priya wears a saree"
  const other = sent.names.find((h) => !h.poss && h.start > at && h.start < end && !attr!.chars.includes(h.name));
  if (other) end = s.slice(0, other.start).replace(/\s*(?:,|and|,\s*and|while|as|;|&)\s*$/i, "").length;
  if (end > at) { sent.listRange = [at, end]; sent.listAttr = attr; }
}
function scanAction(st: State, sent: Sent): void {
  if (L.IMAGINE_RE.test(sent.s)) return;
  sent.depict = L.DEPICT_RE.test(sent.s);
  detectIntro(st, sent);
  scanCrowdAndHazards(st, sent); scanSpecials(st, sent); scanStains(st, sent);
  scanNPs(st, sent);
}
/** Recipient of a placed, draped or handed garment ("hands Raj a shirt", "drapes a shawl over Priya", "on Raj's head"). */
function recipientFor(st: State, sent: Sent, np: NP, ctx: Ctx, ctxAt: number): { attr: Attr; giver: Attr; mode: "hand" | "place" } | null {
  if (sent.kind === "dialogue") return null;
  const { s } = sent; const pre = s.slice(0, np.start); const after = s.slice(np.end);
  const ho = L.HANDOVER_RE.exec(pre);
  // the giver is the subject of the hand-over verb, not the nearest name ("Raj hands Priya a scarf": Raj gives)
  const subj = subjectFor(st, sent, ho ? ho.index : ctxAt);
  if (ho) { const who = personAt(st, sent, ho.index + ho[0].lastIndexOf(ho[1]), subj.chars); if (who && !who.chars.some((c) => subj.chars.includes(c))) return { attr: who, giver: subj, mode: "hand" }; }
  const tail = L.RECIPIENT_TAIL_RE.exec(after);
  if (tail) {
    const isTo = /^\s+(?:over to|across to|back to|to)\b/.test(after);
    if (isTo && !L.HANDOVER_VERB_RE.test(pre)) return null;
    if (!isTo && !["on", "state", "handle", "none", "comma", "wear"].includes(ctx)) return null;
    const who = personAt(st, sent, np.end + tail[0].lastIndexOf(tail[1]), isTo ? subj.chars : []);
    if (who && !who.chars.some((c) => subj.chars.includes(c))) return { attr: who, giver: subj, mode: isTo ? "hand" : "place" };
  }
  return null;
}
function scanNPs(st: State, sent: Sent): void {
  const { s } = sent; let prev: { np: NP; ctx: Ctx; attr: Attr } | null = null;
  for (const np of findNPs(sent)) {
    const c = ctxFor(s, np); let ctx = c.ctx;
    let attr: Attr; let borrowed: string | null = null; let giver: { attr: Attr; mode: "hand" | "place" } | null = null;
    if (np.possName) attr = named(np.possName);
    else if (/^(his|her|their)$/.test(np.det)) {
      attr = resolvePronoun(st, sent, np.det, np.start);
      // the wearer beats the owner: "She is wearing his old sweatshirt" — a subject of the other gender wears someone else's garment
      if (WEAR_CTX.has(ctx) && sent.kind === "action") {
        const subj = subjectFor(st, sent, c.at); const pg = np.det === "his" ? "M" : np.det === "her" ? "F" : null; const sg = subj.chars.length === 1 ? st.gender.get(subj.chars[0]) : undefined;
        if (pg && sg && sg !== pg && SUBJECT_VIAS.has(subj.via)) { const own = resolvePronoun(st, sent, np.det, np.start, subj.chars); if (own.chars.length === 1 && own.chars[0] !== subj.chars[0]) borrowed = own.chars[0]; attr = subj; } // owner unresolved: still the subject's to wear
      }
    }
    else if (np.det === "my" && sent.speaker) attr = { chars: [sent.speaker], conf: "HIGH", prefix: "", via: "speaker" };
    else attr = subjectFor(st, sent, np.start);
    if (prev && /^\s*(?:,|and|,\s*and)\s*$/i.test(s.slice(prev.np.end, np.start)) && (ctx === "none" || ctx === "comma") && !L.FINITE_RE.test(s.slice(prev.np.end, np.start))) {
      ctx = prev.ctx === "still" || prev.ctx === "same" ? "wear" : prev.ctx;
      if (!np.possName && !/^(his|her|their)$/.test(np.det)) { attr = prev.attr; if (!np.det && !np.mods.length) { if (prev.np.possName) np.possName = prev.np.possName; else if (/^(his|her|their)$/.test(prev.np.det)) np.det = prev.np.det; } } // "Priya's choora and kaleere"
    }
    if (sent.listRange && sent.listAttr && np.headStart >= sent.listRange[0] && np.headStart <= sent.listRange[1] && !np.possName && !/^(his|her|their)$/.test(np.det)) attr = sent.listAttr;
    // the wearer beats the owner: "Priya wears Raj's shirt", "Raj puts on Priya's coat"
    if (np.possName && WEAR_CTX.has(ctx)) { const subj = subjectFor(st, sent, c.at); if (subj.chars.length && SUBJECT_VIAS.has(subj.via) && !subj.chars.includes(np.possName)) { borrowed = np.possName; attr = subj; } }
    const rec = recipientFor(st, sent, np, ctx, c.at);
    if (rec) { attr = rec.attr; giver = { attr: rec.giver, mode: rec.mode }; }
    handleNP(st, sent, np, ctx, attr, giver, borrowed); prev = { np, ctx, attr };
    if (sent.kind === "action") st.lastNP = { text: npText(np), kind: np.kind, owner: borrowed || np.possName || attr.chars[0] || null, end: np.end };
  }
  if (sent.kind === "action") scanItRefs(st, sent);
}
/** The grammatical subject of the sentence: a leading name or he/she/they, else the nearest subject-like token before `pos`. */
function sentenceSubject(st: State, sent: Sent, pos: number): Attr {
  const lead = sent.names.find((h) => !h.poss && !/\S/.test(sent.s.slice(0, h.start)));
  if (lead) return { chars: coord(sent, lead), conf: "HIGH", prefix: "", via: "name" };
  const pr = /^\s*(he|she|they)\b/i.exec(sent.s); if (pr) return resolvePronoun(st, sent, pr[1], pr.index + pr[0].indexOf(pr[1]));
  return subjectFor(st, sent, pos);
}
/** A garment referred to as "it"/"them" after the noun phrase: "picks up Raj's jacket and puts it on", "takes off her jacket and drapes it over Raj's shoulders". */
function scanItRefs(st: State, sent: Sent): void {
  const { s } = sent; let m: RegExpExecArray | null; const ref = st.lastNP; if (!ref) return;
  const inSent = ref.end <= s.length && s.slice(0, ref.end).toLowerCase().includes(ref.text.split(" ").pop()!.toLowerCase());
  const tag = (subj: Attr) => (ref.owner && !subj.chars.includes(ref.owner) ? `${ref.text} (${ref.owner}'s)` : ref.text);
  const on = /\b(?:puts?|pulls?|slips?|shrugs?|throws?|tugs?|straps?|clips?|pins?|slides?|drags?|eases?|wriggles?)\s+(?:it|them)\s+(?:back\s+)?on\b(?!\s+(?:the|a|an|his|her|their|top of)\b)/gi;
  while ((m = on.exec(s))) {
    if (!inSent && !/^\s*(?:[A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?|he|she|they)\s+(?:picks|grabs|snatches|takes|lifts|retrieves|scoops|fishes|pulls)\b/i.test(s)) continue; // "it" must refer to the last garment
    const subj = sentenceSubject(st, sent, m.index); if (!subj.chars.length || !SUBJECT_VIAS.has(subj.via)) continue;
    emit(st, sent, subj, "CHANGE", `Puts on ${tag(subj)}`, inSent ? "HIGH" : "MEDIUM", m.index);
  }
  const over = /\b(drapes?|throws?|wraps?|hangs?|places?|puts?|slips?|lays?|settles?)\s+(?:it|them)\s+(?:over|around|round|on|onto|across)\s+(?=([A-Z][A-Za-z'-]*(?: [A-Z][A-Za-z'-]*)?|him|her|them)\b)/g;
  while ((m = over.exec(s))) {
    if (!inSent) continue;
    const subj = sentenceSubject(st, sent, m.index); const who = personAt(st, sent, m.index + m[0].length, subj.chars); if (!who || who.chars.some((c) => subj.chars.includes(c))) continue;
    const by = subj.chars.length ? ` by ${subj.chars[0]}` : "";
    emit(st, sent, who, ref.kind, `${ref.text} (draped over${by})`, "MEDIUM", m.index); if (by) emit(st, sent, subj, "NOTE", `Puts ${ref.text} on ${who.chars.join(" and ")}`, "MEDIUM", m.index);
  }
}
function scanParen(st: State, sent: Sent): void { scanSpecials(st, sent); scanStains(st, sent); scanNPs(st, sent); scanCrowdAndHazards(st, sent); }
const SAME_DLG = new RegExp(`\\b(?:wearing |in )?(?:the |that )?same (?:old )?((?:(?:${L.MOD_ALT})\\s+)?(?:${L.HEAD_ALT})(?:es|s)?)(?=[,.!?;]|\\s+(?:as|again|from|two|three|four|and|that|you|he|she|i|every|all|to|for)\\b|$)(?:\\s+(as (?:yesterday|last night|before|the other day|on \\w+day|earlier)|again|from yesterday|(?:two|three|four) days running))?`, "i");
/** Who a line of dialogue is addressed to: a vocative name in the sentence ("Priya, take off that coat"), else the only other character in the scene. */
function addresseeFor(st: State, sub: Sent): Attr | null {
  const voc = sub.names.find((h) => !h.poss && h.name !== sub.speaker && (/^\s*$/.test(sub.s.slice(0, h.start)) && /^\s*[,!:]/.test(sub.s.slice(h.end)) || /[,]\s*$/.test(sub.s.slice(0, h.start)) && /^\s*[.!?]?\s*$/.test(sub.s.slice(h.end))));
  if (voc) return { chars: [voc.name], conf: "HIGH", prefix: "", via: "name" };
  const others = L.uniq(sub.allPresent).filter((c) => c !== sub.speaker);
  return others.length === 1 ? { chars: others, conf: "MEDIUM", prefix: "", via: "speaker" } : null;
}
function scanDialogue(st: State, sent: Sent): void {
  for (const sn of L.sentences(sent.s)) {
    const s = sn.text; const sub: Sent = { ...sent, s, at: sent.at + sn.at, names: st.nm.find(s), spans: L.blockedSpans(s), used: [] };
    const same = SAME_DLG.exec(s);
    if (same && sub.speaker && !L.overlaps(sub.spans, same.index, same.index + same[0].length)) {
      const others = L.uniq(sub.allPresent).filter((c) => c !== sub.speaker);
      const attr: Attr = others.length === 1 ? { chars: others, conf: "MEDIUM", prefix: "", via: "speaker" } : NONE;
      emit(st, sub, attr, "CONTINUITY", `Same ${same[1].toLowerCase()} ${(same[2] || "again").toLowerCase()} (dialogue)`, "MEDIUM", same.index, `same ${same[1].toLowerCase()} dialogue`);
      continue;
    }
    if (/\?|\b(was|were|had|gave|bought|yesterday|last night|last week|will|going to|tomorrow|later|keep your shirt on|in my shoes|wears the crown)\b/i.test(s)) continue;
    const imp = /\b(take off|put on|change out of|remove|put|take)\s+(?:that|the|your|those|these|this)\s+/i.exec(s);
    if (imp) {
      const np = findNPs(sub).find((n) => n.start >= imp!.index && n.start <= imp!.index + imp![0].length); if (!np) continue;
      // "put the coat on" / "take the cap off" only; "put the coat on the hook", "take the cap off the bottle" are about objects.
      const tail = /^\s*(?:back\s+)?(on|off)(?=[,.!?;]|\s+(?:and|then|now|please|before|first|again|quickly|properly|for|at once)\b|$)/i.exec(s.slice(np.end)); const verb = imp[1].toLowerCase();
      const dir = /^(?:put|take)$/.test(verb) ? (tail ? tail[1].toLowerCase() : null) : verb;
      if (!dir) continue;
      const attr = addresseeFor(st, sub); if (!attr) continue;
      emit(st, sub, attr, "CHANGE", `${/on/.test(dir) || dir === "put on" ? "Puts on" : /change/.test(dir) ? "Changes out of" : "Takes off"} ${npText(np)}`, "MEDIUM", imp.index);
      for (const c of np.mods.filter(L.isCondMod)) condCue(st, sub, attr, `${c} ${np.written}`, np.start);
      continue;
    }
    const dec = /\b(these are|this is|i'm wearing|i am wearing|i've got on)\s+(?:my|a|an)?\s*/i.exec(s);
    if (dec && sub.speaker) { const np = findNPs(sub).find((n) => n.start >= dec!.index && n.start <= dec!.index + dec![0].length); if (np && !(np.ambig && !np.mods.length)) emit(st, sub, { chars: [sub.speaker], conf: "LOW", prefix: "", via: "speaker" }, np.kind, `${npText(np)} (dialogue)`, "LOW", dec.index); }
  }
}
function timeText(card: string, slug: boolean): string {
  const c = card.toUpperCase().replace(/^(TITLE|SUPER|SUPERIMPOSE|CARD):\s*/, "").replace(/[:.]$/, "").trim();
  if (/\b(?:BACK TO|RETURN TO)\b|END (?:OF )?(?:FLASHBACK|DREAM|MONTAGE)/.test(c)) return `Back to present: resume present-day costumes (${c})`;
  if (/CONTINUOUS|SAME/.test(c)) return slug ? "Slug CONTINUOUS: hold previous scene costumes" : `Time card: ${c} - hold costume`;
  if (/FLASHBACK|FLASH ?FORWARD|DREAM|MEMORY|MONTAGE|PRESENT DAY|^(19|20)\d{2}$|EARLIER|AGO/.test(c)) return `Flashback/time shift: period or younger look (${c})`;
  if (/^DAY \S+/.test(c) && !/LATER/.test(c)) return `Story day ${c.replace(/^DAY /, "")}`;
  if (slug && /LATER|MEANWHILE|INTERCUT/.test(c)) return `Slug ${c}: time jump in same location, confirm same look`;
  const cons = /MONTH|YEAR|DECADE/.test(c) ? "new looks, ageing" : /WEEK|FORTNIGHT/.test(c) ? "fresh day change, new looks" : /NEXT (MORNING|DAY)|THAT NIGHT|TOMORROW|DAY/.test(c) ? "fresh day change" : "hold costume";
  return `Time card: ${c} - ${cons}`;
}
function scanSlug(st: State, sent: Sent): void {
  const s = sent.s; const paren = /\(([^)]+)\)/.exec(s); const parts = (paren ? s.slice(0, paren.index) : s).split(/\s+-\s+/); const tail = parts.length > 1 ? parts.slice(1).join(" - ") : "";
  const tokens = [L.SLUG_TIME.exec(tail.toUpperCase())?.[1], ...(paren ? paren[1].toUpperCase().split(/\s*[,;/]\s*/).map((p) => L.SLUG_TIME.exec(p)?.[1] || (/^(19|20)\d{2}$/.test(p) ? p : undefined)) : [])].filter((x): x is string => !!x);
  for (const t of L.uniq(tokens)) { if (/^(19|20)\d{2}$/.test(t)) emit(st, sent, NONE, "NOTE", `Period: ${t} - era-appropriate wardrobe`, "MEDIUM", 0); else emit(st, sent, NONE, "CONTINUITY", timeText(t, true), "HIGH", 0); }
  const w = L.SLUG_WEATHER_RE.exec(`${tail} ${paren ? paren[1] : ""}`.toUpperCase()); if (w) note(st, sent, NONE, "Rain/water", w[1], "wet costumes, duplicates, drying", "LOW", 0);
  const loc = L.LOCATION_RE.exec(s); if (loc) emit(st, sent, NONE, "NOTE", `Location: ${loc[1].toLowerCase()} - dress set with garments, swatches, racks`, "MEDIUM", loc.index);
  const ev = L.SLUG_EVENT_RE.exec(s.toUpperCase()); if (ev) emit(st, sent, NONE, "NOTE", `Event: ${ev[1].toLowerCase()} - ceremonial/formal wardrobe for all`, "MEDIUM", ev.index);
}

// ---------- scene runner ----------
/** Unify quotes and spaces; collapse runs of spaces inside a line but keep the leading indent (dialogue is two-space indented). */
function normalise(text: string): string {
  return text.replace(/\r/g, "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ").replace(/\t/g, "  ")
    .split("\n").map((l) => { const lead = /^ */.exec(l)![0]; return lead + l.slice(lead.length).replace(/ {2,}/g, " "); }).join("\n");
}
const SUBJECT_FAMILIES = new Set(["blood", "fire/smoke", "fight/violence", "sweat", "water immersion", "mud/dirt", "physical action", "shower/bath", "damage"]);
function finalize(raw: RawCue[]): Cue[] {
  raw.sort((a, b) => a.line - b.line || a.at - b.at);
  const seen = new Map<string, RawCue>(); let kept: RawCue[] = [];
  for (const c of raw) { const p = seen.get(c.key); if (!p) { seen.set(c.key, c); kept.push(c); } else if (RANK[c.confidence] > RANK[p.confidence]) p.confidence = c.confidence; }
  // one CONDITION per fact (same paragraph): "Kurta torn" is subsumed by "Kurta torn at sleeve", "Soaked in blood" by "Shirt soaked with blood"
  const words = (t: string) => new Set(t.toLowerCase().split(/[\s/,()]+/).filter((w) => w && !/^(?:in|with|at|the|a|an|and|on|now|still|of)$/.test(w)));
  const conds = kept.filter((c) => c.kind === "CONDITION" && c.character);
  const subsumed = new Set<RawCue>();
  for (const a of conds) for (const b of conds) {
    if (a === b || a.character !== b.character || a.line !== b.line || subsumed.has(a)) continue;
    const wa = words(a.text), wb = words(b.text); if (wa.size >= wb.size) continue;
    if ([...wa].every((w) => wb.has(w))) { subsumed.add(a); if (RANK[a.confidence] > RANK[b.confidence]) b.confidence = a.confidence; }
  }
  kept = kept.filter((c) => !subsumed.has(c));
  // a scene-wide hazard note is redundant once the same hazard is pinned to a character
  const perChar = new Set(kept.filter((c) => c.character && c.key.includes("|NOTE|hazard ")).map((c) => c.key.split("|NOTE|hazard ")[1]));
  kept = kept.filter((c) => !(c.character == null && c.key.startsWith("|NOTE|hazard ") && SUBJECT_FAMILIES.has(c.key.slice("|NOTE|hazard ".length)) && perChar.has(c.key.slice("|NOTE|hazard ".length))));
  let result = kept;
  if (result.length > 30) { const rank = (c: RawCue) => RANK[c.confidence] * 2 + (c.kind === "NOTE" ? 0 : 1); const drop = new Set([...result].sort((a, b) => rank(a) - rank(b) || kept.indexOf(b) - kept.indexOf(a)).slice(0, result.length - 30)); result = result.filter((c) => !drop.has(c)); }
  return result.map(({ character, kind, text, quote, confidence }) => ({ character, kind, text, quote, confidence }));
}
function runScene(text: string, nm: NameMatcher, gender: Map<string, "M" | "F">, chars: string[]): Cue[] {
  const st: State = { nm, gender, chars, out: [], lastNP: null };
  const lines = normalise(text).split("\n").filter((l) => !/^\s*(\d+|\(CONTINUED\)|CONTINUED:?)\s*$/.test(l));
  const present: string[] = []; let speaker: string | null = null; let prevLast: string | null = null;
  const cueOf = (t: string) => /^([A-Z0-9][A-Z0-9 .'\-#&()]*):$/.exec(t);
  const allPresent = L.uniq(lines.slice(1).flatMap((line) => {
    const t = line.trim(); const cue = cueOf(t);
    if (cue && !/^\s/.test(line) && !L.TRANSITION_RE.test(t)) { const who = cue[1].replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D)\)/gi, "").trim(); const n = nm.byLower.get(who.toLowerCase()) ?? nm.forms.get(who.toUpperCase())?.name; return n ? [n] : []; }
    if (/^\s+\(.*\)$/.test(line)) return nm.find(t).filter((h) => !h.weak).map((h) => h.name); // "(to Priya)" puts Priya in the scene
    return isActionLine(line) ? nm.find(t).map((h) => h.name) : [];
  }));
  let paraSubj: string | null = null;
  const mk = (s: string, kind: Sent["kind"], line: number, at: number, paraNames: string[]): Sent => ({ s, kind, names: nm.find(s), spans: L.blockedSpans(s), used: [], paraNames, paraSubj, prevLast, speaker, present, allPresent, listRange: null, listAttr: null, depict: false, line, at });
  lines.forEach((line, li) => {
    const t = line.trim(); if (!t) return;
    if (li === 0) { scanSlug(st, mk(t, "action", 0, 0, [])); return; }
    if (L.TRANSITION_RE.test(t) && !/^\s/.test(line)) { speaker = null; emit(st, mk(t, "action", li, 0, []), NONE, "CONTINUITY", timeText(t, false), "HIGH", 0); return; }
    const cue = cueOf(t);
    if (cue && !/^\s/.test(line)) {
      const who = cue[1].replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D)\)/gi, "").trim();
      speaker = nm.byLower.get(who.toLowerCase()) ?? nm.forms.get(who.toUpperCase())?.name ?? null;
      if (speaker) { prevLast = speaker; present.push(speaker); }
      return;
    }
    if (/^\s+\(.*\)$/.test(line)) { scanParen(st, mk(t.slice(1, -1), "paren", li, 1, [])); return; }
    if (/^ {2}/.test(line)) { scanDialogue(st, mk(t, "dialogue", li, 0, [])); return; }
    if (L.TIME_CARD.test(t) && !/[a-z]/.test(t)) { emit(st, mk(t, "action", li, 0, []), NONE, "CONTINUITY", timeText(t.replace(/\.$/, ""), false), "HIGH", 0); return; }
    speaker = null; const paraNames: string[] = []; paraSubj = null;
    for (const sn of L.sentences(t)) {
      const sent = mk(sn.text, "action", li, sn.at, [...paraNames]); scanAction(st, sent);
      for (const h of sent.names) { paraNames.push(h.name); if (!h.poss) present.push(h.name); }
      const lead = sent.names.find((h) => !h.poss && !/\S/.test(sn.text.slice(0, h.start))); if (lead) paraSubj = lead.name;
    }
    if (paraNames.length) prevLast = paraNames[paraNames.length - 1];
  });
  return finalize(st.out);
}

// ---------- exports ----------
export function extractSceneCues(text: string, characterNames: string[]): Cue[] {
  const nm = buildNameMatcher(characterNames); return runScene(text, nm, inferGenders([text], nm, characterNames), characterNames.map((c) => c.trim()).filter(Boolean));
}
export function extractCuesRules(scenes: SceneInput[], characterNames: string[]): ExtractedScene[] {
  const nm = buildNameMatcher(characterNames); const gender = inferGenders(scenes.map((s) => s.text), nm, characterNames); const chars = characterNames.map((c) => c.trim()).filter(Boolean);
  return scenes.map((s) => ({ number: s.number, cues: runScene(s.text, nm, gender, chars) }));
}
