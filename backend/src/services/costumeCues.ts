/**
 * Tier 2: AI costume-cue extraction from scene text (advisory).
 * Uses the Claude API with structured output. Cues are stored as SUGGESTED and a person accepts or dismisses them.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/errors";

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export const CUE_KINDS = ["GARMENT", "ACCESSORY", "CONDITION", "CHANGE", "CONTINUITY", "NOTE"] as const;

const CueSchema = z.object({
  character: z.string().nullable().describe("Character name exactly as listed, or null for a scene-wide note"),
  kind: z.enum(CUE_KINDS),
  text: z.string().describe("The cue in at most 20 words, e.g. 'White shirt, sleeves rolled, top button open'"),
  quote: z.string().nullable().describe("Short verbatim excerpt from the scene that supports the cue"),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});
const ResultSchema = z.object({
  scenes: z.array(z.object({ number: z.string(), cues: z.array(CueSchema) })),
});
export type ExtractedScene = z.infer<typeof ResultSchema>["scenes"][number];

const SYSTEM = `You are the breakdown assistant for a film costume department. You read screenplay scenes and list every wardrobe-relevant fact so the costume team can plan changes, duplicates and continuity.

Extract only what the text states or clearly implies. Never invent garments. For each cue give:
- character: the character it concerns, using the name exactly as it appears in the provided character list, or null for a scene-wide note (weather, period, uniforms for a crowd).
- kind: GARMENT (a specific garment or outfit worn), ACCESSORY (watch, jewellery, bag, glasses, hat, shoes), CONDITION (state of clothing: wet, muddy, torn, bloodied, sweaty, dishevelled, burnt), CHANGE (a costume change within the scene, or an outfit explicitly different from what the character wore before), CONTINUITY (the same clothes as an earlier scene, a time jump, "later that night", flashback), NOTE (anything else the costume team must know: stunt double, duplicates needed, actions that will damage clothing such as fights, rain, food, blood).
- text: the cue in at most 20 words, written for a wardrobe assistant.
- quote: a short verbatim excerpt supporting the cue, or null.
- confidence: HIGH when the script says it outright, MEDIUM when strongly implied, LOW when it is an inference.

Skip dialogue-only mentions that have no wardrobe consequence. Return every scene you were given, in the same order, with an empty cues list when there is nothing wardrobe-relevant.`;

let client: Anthropic | null = null;
function getClient() {
  if (!aiEnabled()) throw new HttpError(503, "AI cue extraction is not configured on this server. Set ANTHROPIC_API_KEY in the environment.");
  if (!client) client = new Anthropic();
  return client;
}

export interface SceneInput { id: string; number: string; name: string | null; text: string }

/** Extract cues for a batch of scenes (keep batches small: ~6 scenes or ~24k characters). */
export async function extractCues(scenes: SceneInput[], characterNames: string[]): Promise<{ scenes: ExtractedScene[]; usage: { input: number; output: number } }> {
  const c = getClient();
  const body = scenes.map((s) => `### SCENE ${s.number}${s.name ? ` - ${s.name}` : ""}\n${s.text.trim()}`).join("\n\n");
  const prompt = `Characters in this production: ${characterNames.length ? characterNames.join(", ") : "(none listed yet)"}\n\nScenes:\n\n${body}`;
  try {
    const response = await c.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(ResultSchema) },
    });
    if (response.stop_reason === "refusal") throw new HttpError(502, `The model declined to process this batch${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}.`);
    const parsed = response.parsed_output;
    if (!parsed) throw new HttpError(502, "The model returned an unreadable result. Try again.");
    return { scenes: parsed.scenes, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The Anthropic API key on the server was rejected. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "The AI service is rate limited right now. Try again in a minute.");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `AI service error (${e.status}): ${e.message}`);
    throw e;
  }
}

/**
 * Run extraction for the given scenes and store the cues. Existing SUGGESTED cues on those scenes are replaced;
 * ACCEPTED and DISMISSED cues are kept so nobody has to re-decide.
 */
export async function extractAndStoreCues(projectId: string, sceneIds: string[]) {
  getClient(); // fail fast with a clear 503 when the server has no API key, even if nothing would be sent
  const scenes = await prisma.scene.findMany({ where: { projectId, id: { in: sceneIds } }, orderBy: { sortOrder: "asc" } });
  const withText = scenes.filter((s) => s.scriptText && s.scriptText.trim().length > 0);
  const characters = await prisma.character.findMany({ where: { projectId }, select: { id: true, name: true } });
  const byName = new Map(characters.map((c) => [c.name.trim().toLowerCase(), c.id]));
  let created = 0;
  let usage = { input: 0, output: 0 };
  // batch by size
  const batches: SceneInput[][] = [];
  let cur: SceneInput[] = [];
  let curLen = 0;
  for (const s of withText) {
    const item = { id: s.id, number: s.number, name: s.name, text: s.scriptText || "" };
    if (cur.length && (cur.length >= 6 || curLen + item.text.length > 24000)) { batches.push(cur); cur = []; curLen = 0; }
    cur.push(item);
    curLen += item.text.length;
  }
  if (cur.length) batches.push(cur);

  for (const batch of batches) {
    const result = await extractCues(batch, characters.map((c) => c.name));
    usage = { input: usage.input + result.usage.input, output: usage.output + result.usage.output };
    for (const s of batch) {
      const found = result.scenes.find((r) => r.number.trim().toLowerCase() === s.number.trim().toLowerCase());
      const decided = await prisma.scriptCue.findMany({ where: { sceneId: s.id, status: { in: ["ACCEPTED", "DISMISSED"] } }, select: { text: true } });
      const decidedTexts = new Set(decided.map((d) => d.text.trim().toLowerCase()));
      await prisma.scriptCue.deleteMany({ where: { sceneId: s.id, status: "SUGGESTED" } });
      const rows = (found?.cues || [])
        .filter((c) => c.text.trim() && !decidedTexts.has(c.text.trim().toLowerCase()))
        .map((c) => ({
          projectId,
          sceneId: s.id,
          characterId: c.character ? byName.get(c.character.trim().toLowerCase()) || null : null,
          characterName: c.character || null,
          kind: c.kind,
          text: c.text.trim(),
          quote: c.quote?.trim() || null,
          confidence: c.confidence,
          model: AI_MODEL,
        }));
      if (rows.length) await prisma.scriptCue.createMany({ data: rows });
      created += rows.length;
    }
  }
  return { scenesProcessed: withText.length, scenesSkipped: scenes.length - withText.length, cuesCreated: created, usage, model: AI_MODEL };
}
