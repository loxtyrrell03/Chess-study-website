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

  const { brief, constraints = {}, model: modelReq } = req.data || {};
  if (!brief || typeof brief !== "string") {
    throw new HttpsError("invalid-argument", "Provide brief:string");
  }

  // Model allowlist for safety/cost control
  const ALLOWED_MODELS = new Set(["gpt-5", "gpt-4o", "gpt-4o-mini"]);
  const model = (typeof modelReq === 'string' && ALLOWED_MODELS.has(modelReq.trim()))
    ? modelReq.trim() : "gpt-5";

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
            // Optional absolute scheduling info
            date: { type: "string", description: "YYYY-MM-DD" },
            start_time: { type: "string", description: "HH:mm (24h)" },
            end_time: { type: "string", description: "HH:mm (24h)" },
            // Or provide a relative duration
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
                required: ["id", "name"]
              }
            }
          },
          required: ["id", "topic"],
          oneOf: [
            { required: ["duration_min"] },
            { required: ["start_time", "end_time"] }
          ]
        }
      },
      notes: { type: "string" }
    },
    required: ["sessions"]
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

  const system = `You convert user briefs into a study outline and time plan.
Return ONLY data that matches the provided JSON Schema exactly (no extra fields).
If start/end times are provided, use them. Otherwise, infer duration_min per item.
For each top-level session include: id, topic, description, and either duration_min
or (start_time and end_time). Optionally include a subsections[] breakdown for
finer steps. Use ISO dates (YYYY-MM-DD) and 24h times. Avoid any undeclared keys.`;

  const userPrompt =
    `Brief:\n${brief}\n\nConstraints:\n${JSON.stringify(constraints, null, 2)}\n` +
    `Return ONLY JSON matching the schema.`;

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "StudySchedule", schema, strict: true }
      },
      temperature: 1
    });

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
