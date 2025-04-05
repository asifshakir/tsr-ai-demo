// index.mjs
import "dotenv/config";
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

import { initRAG, getChain } from "./rag/initRag.js";
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

app.get("/health", (req, res) => res.send("OK"));

await initRAG();
registerRoutes(app);

app.listen(port, () =>
  logger.info(`Server running at http://localhost:${port}`)
);

process.on("SIGINT", () => {
  logger.info("Shutting down server...");
  process.exit();
});

process.on("SIGTERM", () => {
  logger.info("Shutting down server...");
  process.exit();
});
