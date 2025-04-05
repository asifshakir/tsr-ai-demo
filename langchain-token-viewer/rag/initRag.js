// rag/initRag.js
import fs from "fs";
import path from "path";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { RunnableSequence } from "@langchain/core/runnables";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { PromptTemplate } from "@langchain/core/prompts";
import { logger } from "../utils/logger.js";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";

let vectorStore;
let chain;

class LoggingEmbeddings extends OpenAIEmbeddings {
  async embedDocuments(texts) {
    logger.info(`🔹 Embedding ${texts.length} documents...`);
    return super.embedDocuments(texts);
  }

  async embedQuery(text) {
    logger.info(`🔍 Embedding query: ${text.slice(0, 50)}...`);
    return super.embedQuery(text);
  }
}

async function loadDocuments(folderPath) {
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith(".pdf"));
  const docs = [];
  for (const file of files) {
    const loader = new PDFLoader(path.join(folderPath, file));
    const rawDocs = await loader.load();
    for (let i = 0; i < rawDocs.length; i++) {
      rawDocs[i].metadata.source = file;
      rawDocs[i].metadata.chunkIndex = i;
    }
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 100 });
    const splitDocs = await splitter.splitDocuments(rawDocs);
    docs.push(...splitDocs);
  }
  return docs;
}

export async function initRAG() {
  const embeddings = new LoggingEmbeddings({ modelName: "text-embedding-ada-002" });
  const indexPath = "cache/index";

  if (fs.existsSync(indexPath)) {
    vectorStore = await HNSWLib.load(indexPath, embeddings);
    logger.info("✅ Loaded vector store from disk");
  } else {
    const docs = await loadDocuments("./pdfs");
    vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
    await vectorStore.save(indexPath);
    logger.info("💾 Saved new vector store to disk");
  }

  const retriever = {
    getRelevantDocuments: async (query) => {
      const results = await vectorStore.similaritySearchWithScore(query, 5);
      return results.map(([doc, score]) => {
        return {
          ...doc,
          metadata: {
            ...doc.metadata,
            score,
          },
        };
      });
    }
  };

  const llm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0.2 });
  const prompt = PromptTemplate.fromTemplate(`
Answer the user's question using the provided context. Include citations in square brackets referencing the source and page, e.g. [filename.pdf p.3].

Context:
{context}

Question:
{input}`);

  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  chain = RunnableSequence.from([
    async (input) => {
      const sourceDocuments = await retriever.getRelevantDocuments(input.query);

      const enrichedDocs = sourceDocuments.map(doc => {
        const source = doc.metadata?.source || "unknown";
        const page = doc.metadata?.loc?.pageNumber || 1;
        return {
          ...doc,
          pageContent: `${doc.pageContent}\n\n[source: ${source}, page: ${page}]`
        };
      });

      return {
        input: input.query,
        context: enrichedDocs,
        sourceDocuments: enrichedDocs
      };
    },
    async ({ input, context, sourceDocuments }) => {
      const text = await combineDocsChain.invoke({ input, context });
      return { text, sourceDocuments };
    }
  ]);

  logger.info("✅ LangChain RAG initialized.");
}

export function getChain() {
  return chain;
}