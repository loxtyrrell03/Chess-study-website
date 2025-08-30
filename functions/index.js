/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { setGlobalOptions } = require("firebase-functions");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const OpenAI = require("openai").default;

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// Secret for OpenAI API key (set via CLI: firebase functions:secrets:set OPENAI_API_KEY)
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// Callable function: generate a schedule JSON from a user brief
exports.generateSchedule = onCall({ region: "us-central1", secrets: [OPENAI_API_KEY] }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const { brief, constraints = {}, model: modelReq, controls = {} } = req.data || {};
  if (!brief || typeof brief !== "string") {
    throw new HttpsError("invalid-argument", "Provide brief:string");
  }

  // Model allowlist for safety/cost control
  const ALLOWED_MODELS = new Set(["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"]);
  const model = (typeof modelReq === 'string' && ALLOWED_MODELS.has(modelReq.trim()))
    ? modelReq.trim() : "gpt-5-mini";

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      timezone: { type: "string" },
      sessions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            topic: { type: "string" },
            description: { type: "string" },
            // Relative duration for this session (mandatory in strict mode)
            duration_min: { type: "integer", minimum: 1, description: "Whole minutes for this section" },
            // Optional learning resources
            materials: { type: "array", items: { type: "string" } },
            // Optional fine-grained breakdown
            subsections: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  duration_min: { type: "integer", minimum: 1 },
                  materials: { type: "array", items: { type: "string" } }
                },
                required: ["id", "name", "description", "duration_min", "materials"]
              }
            }
          },
          required: ["id", "topic", "description", "duration_min", "materials", "subsections"]
        }
      },
      notes: { type: "string" }
    },
    required: ["title", "timezone", "sessions", "notes"]
  };

  // Ensure every object in the schema explicitly has additionalProperties: false
  function enforceNoExtra(obj){
    if(!obj || typeof obj !== 'object') return;
    if(obj.type === 'object'){
      obj.additionalProperties = false;
      if (obj.properties && typeof obj.properties === 'object'){
        Object.values(obj.properties).forEach(enforceNoExtra);
      }
      if (obj.patternProperties && typeof obj.patternProperties === 'object'){
        Object.values(obj.patternProperties).forEach(enforceNoExtra);
      }
    }
    if(obj.type === 'array' && obj.items){ enforceNoExtra(obj.items); }
    if(Array.isArray(obj.anyOf)) obj.anyOf.forEach(enforceNoExtra);
    if(Array.isArray(obj.oneOf)) obj.oneOf.forEach(enforceNoExtra);
    if(Array.isArray(obj.allOf)) obj.allOf.forEach(enforceNoExtra);
  }
  enforceNoExtra(schema);
  logger.info("schema additionalProperties checks", {
    rootAP: schema.additionalProperties === false,
    sessionAP: schema.properties?.sessions?.items?.additionalProperties === false
  });

  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

  const includeLinks = !!controls.include_links;
  const includeDescriptions = !!controls.include_descriptions;
  const includeSubsections = !!controls.include_subsections;

  const system = `You convert user briefs into a study outline and timed sections.
Return ONLY JSON exactly matching the provided JSON Schema (no extra fields).
The root object must include title, timezone, sessions, and notes.
For each session include id, topic, description, duration_min (whole minutes),
materials (array, can be empty), and subsections (array, can be empty). Each
subsection includes id, name, description and duration_min. Do not invent keys.

Output controls (apply strictly):
- Include descriptions: ${includeDescriptions ? 'YES' : 'NO (set all description to empty string)'}
- Include link suggestions (materials arrays): ${includeLinks ? 'YES' : 'NO (use empty arrays)'}
- Include subsections: ${includeSubsections ? 'YES' : 'NO (use empty arrays)'}
`;

  const userPrompt =
    `Brief:\n${brief}\n\nConstraints:\n${JSON.stringify(constraints, null, 2)}\n` +
    `Return ONLY JSON matching the schema.`;

  try {
    logger.info("generateSchedule starting", { model, controls: { includeLinks, includeDescriptions, includeSubsections } });
    const reqParams = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "StudySchedule", schema, strict: true }
      }
    };
    // Some models only support default temperature; omit unless supported.
    if (model === 'gpt-4o' || model === 'gpt-4o-mini') reqParams.temperature = 0.2;

    const completion = await client.chat.completions.create(reqParams);

    const content = completion.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(content); }
    catch (err) {
      logger.error("JSON parse failed", { contentSnippet: String(content).slice(0, 200) });
      throw new HttpsError("internal", "Model did not return valid JSON");
    }

    return { ok: true, schedule: data, model };
  } catch (e) {
    logger.error("generateSchedule failed", e);
    throw new HttpsError("internal", "Failed to generate schedule");
  }
});
