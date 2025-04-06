// routes/whisper.js
import express from "express";
import fs from "fs";
import { OpenAI } from "openai";
import { upload } from "../utils/multerConfig.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const whisperRouter = express.Router();

whisperRouter.post("/", upload.single("file"), async (req, res) => {
  const filePath = req.file.path;
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });
    fs.unlinkSync(filePath);
    res.json({ instruction: transcription.text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});