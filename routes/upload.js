// routes/upload.js
import express from "express";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import { upload } from "../utils/multerConfig.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const uploadRouter = express.Router();

uploadRouter.post("/", upload.single("image"), async (req, res) => {
  const imagePath = req.file.path;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const imageBytes = fs.readFileSync(imagePath);
    const base64Image = imageBytes.toString("base64");
    const result = await model.generateContent([
      { text: "Read all Arabic text from this Islamic image." },
      { inlineData: { mimeType: "image/jpeg", data: base64Image } },
    ]);
    const response = await result.response;
    const arabicText = await response.text();
    const translation = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `Translate to English (Shia style):\n\n${arabicText}` }],
    });
    fs.unlinkSync(imagePath);
    res.json({ arabic: arabicText, translation: translation.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ error: "Failed to process image." });
  }
});