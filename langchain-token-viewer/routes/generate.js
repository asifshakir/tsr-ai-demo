// routes/generate.js
import express from "express";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const generateRouter = express.Router();

generateRouter.post("/", async (req, res) => {
  const { prompt, model } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    res.json(response.choices[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});