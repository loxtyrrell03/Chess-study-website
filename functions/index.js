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

  const { brief, constraints = {} } = req.data || {};
  if (!brief || typeof brief !== "string") {
    throw new HttpsError("invalid-argument", "Provide brief:string");
  }

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      timezone: { type: "string" },
      sessions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            start_time: { type: "string", description: "HH:mm (24h)" },
            end_time: { type: "string", description: "HH:mm (24h)" },
            duration_min: { type: "integer" },
            topic: { type: "string" },
            description: { type: "string" },
            materials: { type: "array", items: { type: "string" } }
          },
          required: ["id", "date", "start_time", "end_time", "topic"]
        }
      },
      notes: { type: "string" }
    },
    required: ["sessions"]
  };

  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

  const system = `You convert study briefs into conflict-free schedules.
Respect constraints if present: timezone, start_date, days_of_week, session_length_min,
max_daily_minutes, consecutive_days. Use ISO dates (YYYY-MM-DD) and 24h times.`;

  const userPrompt =
    `Brief:\n${brief}\n\nConstraints:\n${JSON.stringify(constraints, null, 2)}\n` +
    `Return ONLY JSON matching the schema.`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "StudySchedule", schema, strict: true }
      },
      temperature: 0.2
    });

    const content = completion.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(content); }
    catch (err) {
      logger.error("JSON parse failed", { contentSnippet: String(content).slice(0, 200) });
      throw new HttpsError("internal", "Model did not return valid JSON");
    }

    return { ok: true, schedule: data };
  } catch (e) {
    logger.error("generateSchedule failed", e);
    throw new HttpsError("internal", "Failed to generate schedule");
  }
});
