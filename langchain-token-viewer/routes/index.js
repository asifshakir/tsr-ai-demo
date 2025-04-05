// routes/index.js
import express from "express";
import { askRouter } from "./ask.js";
import { uploadRouter } from "./upload.js";
import { generateRouter } from "./generate.js";
import { whisperRouter } from "./whisper.js";
import { updateJsonRouter } from "./updateJson.js";
import { updateClassRouter } from "./updateClass.js";

export const registerRoutes = (app) => {
  app.use("/ask", askRouter);
  app.use("/upload", uploadRouter);
  app.use("/generate", generateRouter);
  app.use("/whisper", whisperRouter);
  app.use("/update-json", updateJsonRouter);
  app.use("/update-class", updateClassRouter);

  // Global error handler
  app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error." });
  });
};