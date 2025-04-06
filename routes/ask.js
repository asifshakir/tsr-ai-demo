import express from "express";
import { getChainForNamespace, getNamespaces } from "../rag/initRag.js";
import { logger } from "../utils/logger.js";

export const askRouter = express.Router();

// Health check
askRouter.get("/status", (req, res) => {
  res.send("RAG system is running ✅");
});

// List all available vector store namespaces
askRouter.get("/namespaces", (req, res) => {
  try {
    const namespaces = getNamespaces();
    res.json({ namespaces });
  } catch (err) {
    logger.error("Error fetching namespaces", { message: err.message });
    res.status(500).json({ error: "Failed to fetch namespaces" });
  }
});

// Ask a question using a specific namespace
askRouter.post("/", async (req, res) => {
  const { question, namespace } = req.body;
  const chain = getChainForNamespace(namespace);

  if (!chain) {
    return res.status(400).json({ error: `Namespace '${namespace}' not loaded` });
  }

  try {
    const result = await chain.invoke({ query: question });

    const citations = result.sourceDocuments?.map((doc, i) => {
      const source = doc.metadata.source || "Unknown";
      const page = doc.metadata.loc?.pageNumber || 1;
      return {
        index: i + 1,
        source,
        snippet: doc.pageContent.slice(0, 200),
        anchor: `${source}#page=${page}`,
      };
    }) || [];

    res.json({ answer: result.text, citations });
  } catch (err) {
    logger.error("Error handling question", { message: err.message, stack: err.stack });
    res.status(500).send("Error during question handling");
  }
});
