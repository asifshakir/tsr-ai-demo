// routes/updateClass.js
import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const updateCache = new Map();
export const updateClassRouter = express.Router();

const ClassDetailsSchema = z.object({
  code: z.string(),
  gender: z.enum(["gents", "ladies"]),
  language: z.enum(["english", "urdu", "gujarati"]),
  level: z.enum(["salman", "abuzar", "miqdad", "ammar", "bilal"]),
  teacher: z.string(),
  startedOn: z.string(),
  format: z.enum(["online", "offline"]),
  address: z.string(),
  city: z.string(),
  country: z.string(),
  location: z.string(),
  tags: z.array(z.string()),
  students: z.array(z.string()),
  schedule: z.object({ day: z.string(), hour: z.string(), minute: z.string(), timezone: z.string() })
});

async function updateObjectViaLLM({ original, instruction }) {
  const schemaName = "classUpdate";
  const key = crypto.createHash("sha256").update(schemaName + JSON.stringify(original) + instruction).digest("hex");
  if (updateCache.has(key)) return updateCache.get(key);

  const messages = [
    {
      role: "system",
      content: `You are a structured JSON editor. Use schema '${schemaName}' to update only requested fields.`,
    },
    {
      role: "user",
      content: `Original:\n${JSON.stringify(original)}\n\nInstruction:\n${instruction}`,
    },
  ];

  const response = await openai.beta.chat.completions.parse({
    model: "gpt-4o-2024-08-06",
    messages,
    response_format: zodResponseFormat(ClassDetailsSchema, schemaName),
  });

  const updated = response.choices[0].message.parsed;
  updateCache.set(key, updated);
  return updated;
}

updateClassRouter.post("/", async (req, res) => {
  const { instruction, original } = req.body;
  try {
    const updated = await updateObjectViaLLM({ instruction, original });
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});