// routes/ask.js
import express from "express";
import { getChain } from "../rag/initRag.js";
import { logger } from "../utils/logger.js";

export const askRouter = express.Router();

// Status check endpoint
askRouter.get("/status", (req, res) => {
  const chain = getChain();
  if (chain) return res.send("RAG chain is initialized ✅");
  res.status(500).send("RAG chain not ready ❌");
});

askRouter.post("/", async (req, res) => {
  const chain = getChain();
  const { question } = req.body;

  if (!chain) return res.status(500).send("RAG model not ready");

  try {
    const result = await chain.invoke({ query: question });

    const citations = result.sourceDocuments?.map((doc, i) => {
      const source = doc.metadata.source || "Unknown";
      const page = doc.metadata.loc?.pageNumber || 1;
      return {
        index: i + 1,
        source,
        snippet: doc.pageContent.slice(0, 200),
        anchor: `${source}#page=${page}`
      };
    }) || [];

    res.json({ answer: result.text, citations });
  } catch (err) {
    logger.error("Error handling question", { message: err.message, stack: err.stack });
    if (err.message.includes("Invalid API key")) {
      return res.status(401).send("Invalid OpenAI API key");
    } else if (err.message.includes("Rate limit")) {
      return res.status(429).send("Rate limit exceeded. Please try again later.");
    }
    res.status(500).send("Error during question handling");
  }
});