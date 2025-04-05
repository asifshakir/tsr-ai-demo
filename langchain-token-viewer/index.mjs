// index.mjs
import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

import { initRAGs, getChainForNamespace, getNamespaces } from "./rag/initRag.js";

import { registerRoutes } from "./routes/index.js";

import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(join(__dirname, "public")));
app.use("/pdfs", express.static(join(__dirname, "pdfs")));

await initRAGs();

app.get("/namespaces", (req, res) => {
  res.json(getNamespaces());
});

app.post("/ask", async (req, res) => {
  const { question, namespace } = req.body;
  const chain = getChainForNamespace(namespace);

  if (!chain) return res.status(400).json({ error: `Namespace '${namespace}' not loaded` });

  try {
    const result = await chain.invoke({ query: question });
    res.json({ answer: result.text, citations: result.sourceDocuments || [] });
  } catch (err) {
    logger.error("Error answering question", { message: err.message, stack: err.stack });
    res.status(500).send("Internal error");
  }
});

registerRoutes(app);

app.listen(port, () => logger.info(`Server running at http://localhost:${port}`));
