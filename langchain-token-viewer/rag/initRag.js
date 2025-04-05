// rag/initRag.js
import fs from "fs";
import path from "path";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { RunnableSequence } from "@langchain/core/runnables";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { PromptTemplate } from "@langchain/core/prompts";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { logger } from "../utils/logger.js";

const vectorStores = {};

export async function initRAGs() {
  const basePath = path.join("./pdfs");
  const subfolders = fs.readdirSync(basePath).filter(f => fs.lstatSync(path.join(basePath, f)).isDirectory());

  for (const namespace of subfolders) {
    const folderPath = path.join(basePath, namespace);
    const indexPath = `cache/${namespace}`;
    const embeddings = new OpenAIEmbeddings({ modelName: "text-embedding-ada-002" });

    let vectorStore;
    if (fs.existsSync(indexPath)) {
      vectorStore = await HNSWLib.load(indexPath, embeddings);
      logger.info(`✅ Loaded vector store for '${namespace}' from disk`);
    } else {
      const docs = await loadDocuments(folderPath);
      vectorStore = await HNSWLib.fromDocuments(docs, embeddings);
      await vectorStore.save(indexPath);
      logger.info(`💾 Created and saved vector store for '${namespace}'`);
    }

    const retriever = {
      getRelevantDocuments: async (query) => {
        const results = await vectorStore.similaritySearchWithScore(query, 5);
        return results.map(([doc, score]) => ({ ...doc, metadata: { ...doc.metadata, score } }));
      },
    };

    const llm = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0.2 });
    const prompt = PromptTemplate.fromTemplate(`
Answer the user's question using the provided context. Include citations in square brackets referencing the source and page, e.g. [filename.pdf p.3].

Context:
{context}

Question:
{input}`);

    const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
    const chain = RunnableSequence.from([
      async (input) => {
        const sourceDocuments = await retriever.getRelevantDocuments(input.query);
        return {
          input: input.query,
          context: sourceDocuments,
          sourceDocuments,
        };
      },
      async ({ input, context, sourceDocuments }) => {
        const text = await combineDocsChain.invoke({ input, context });
        return { text, sourceDocuments };
      },
    ]);

    vectorStores[namespace] = chain;
  }
}

export function getChainForNamespace(namespace) {
  return vectorStores[namespace];
}

export function getNamespaces() {
  return Object.keys(vectorStores);
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
