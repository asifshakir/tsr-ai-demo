// routes/updateJson.js
import express from "express";
import crypto from "crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const updateCache = new Map();

export const updateJsonRouter = express.Router();

async function updateObjectViaLLM({ original, instruction }) {
  const key = crypto.createHash("sha256").update(JSON.stringify(original) + instruction).digest("hex");
  if (updateCache.has(key)) return updateCache.get(key);

  const messages = [
    { role: "system", content: `You are a JSON editor. Update only specified fields.` },
    { role: "user", content: `Original:\n${JSON.stringify(original)}\n\nInstruction:\n${instruction}` },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.2,
  });

  const updated = JSON.parse(response.choices[0].message.content);
  updateCache.set(key, updated);
  return updated;
}

updateJsonRouter.post("/", async (req, res) => {
  const { instruction, original } = req.body;
  try {
    const updated = await updateObjectViaLLM({ instruction, original });
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});