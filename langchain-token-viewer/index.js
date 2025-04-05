require("dotenv").config();
const express = require("express");
const { OpenAI } = require("openai");
const { zodResponseFormat } = require("openai/helpers/zod");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const { z } = require("zod");
const winston = require("winston");
const { GoogleGenerativeAI  } = require('@google/generative-ai');
const { ImageAnnotatorClient } = require("@google-cloud/vision");

const app = express();
const port = 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const visionClient = new ImageAnnotatorClient({
  keyFilename: "service-account.json", // Use if using service accounts
});

app.use(cors());
app.use(express.static("public"));

// ✅ Winston logger setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) =>
        `[${info.timestamp}] [${info.level.toUpperCase()}] ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// ✅ Multer for Whisper uploads
const storage = multer.diskStorage({
  destination: "./uploads",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// ✅ ClassDetails Zod schema
const ClassDetailsSchema = z.object({
  code: z.string(),
  gender: z.enum(["gents", "ladies"]),
  language: z.enum(["english", "urdu", "gujarati"]),
  level: z.enum(["salman", "abuzar", "miqdad", "ammar", "bilal"]),
  teacher: z.string(),
  startedOn: z.string(),
  format: z.enum(["online", "offline"]),
  address: z.string(),
  city: z.string(),
  country: z.string(),
  location: z.string(),
  tags: z.array(z.string()),
  students: z.array(z.string()),
  schedule: z.object({
    day: z.string(),
    hour: z.string(),
    minute: z.string(),
    timezone: z.string(),
  }),
});

// ✅ In-memory cache for instruction deduplication
const updateCache = new Map();

// ✅ Shared GPT update logic
async function updateObjectViaLLM({
  original,
  instruction,
  schema,
  schemaName = "structuredUpdate",
}) {
  const key = crypto
    .createHash("sha256")
    .update(schemaName + JSON.stringify(original) + instruction)
    .digest("hex");

  if (updateCache.has(key)) {
    logger.info("⚡ Cache hit for update key: " + key);
    return updateCache.get(key);
  }

  const systemMessage = schema
    ? `You are a structured JSON editor. Use the schema '${schemaName}' to return a valid JSON update.
      Although the input can be in multiple languages but always prefer English, set object property strings only in English script. Update the JSON only with the given instructions, do not update any other properties, just retain original values. Return ONLY valid updated JSON.`
    : `You are a JSON editor. Update the given JSON object based on the instruction. Although the input can be in multiple languages but always prefer English, set object property strings only in English script. Update the JSON only with the given instructions, do not update any other properties, just retain original values. Return ONLY valid updated JSON.`;

  const messages = [
    { role: "system", content: systemMessage },
    {
      role: "user",
      content: `Original:\n${JSON.stringify(
        original,
        null,
        2
      )}\n\nInstruction:\n${instruction}`,
    },
  ];

  try {
    let updated;

    if (schema) {
      const response = await openai.beta.chat.completions.parse({
        model: "gpt-4o-2024-08-06",
        messages,
        response_format: zodResponseFormat(schema, schemaName),
      });
      updated = response.choices[0].message.parsed;
    } else {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.2,
      });
      const raw = response.choices[0].message.content.trim();
      updated = JSON.parse(raw);

      if (schema) {
        try {
          updated = schema.parse(updated);
        } catch (validationErr) {
          logger.warn("⚠️ Parsed output failed schema validation");
          throw validationErr;
        }
      }
    }

    const logPath = `logs/update-${Date.now()}.json`;
    fs.writeFileSync(
      logPath,
      JSON.stringify(
        { timestamp: new Date().toISOString(), instruction, original, updated },
        null,
        2
      )
    );

    updateCache.set(key, updated);
    return updated;
  } catch (err) {
    logger.error("❌ Update failed: " + err.message);
    throw err;
  }
}

// ✅ /generate
app.post("/generate", bodyParser.json(), async (req, res) => {
  const { prompt, model } = req.body;

  try {
    const response = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      logprobs: true,
      top_logprobs: 5,
      temperature: 0.2,
      max_tokens: 50,
    });
    res.json(response.choices[0]);
  } catch (err) {
    logger.error("Generate failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ /whisper
app.post("/whisper", upload.single("file"), async (req, res) => {
  const filePath = req.file.path;

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });
    fs.unlinkSync(filePath);
    logger.info("🎙️ Transcription: " + transcription.text);
    res.json({ instruction: transcription.text });
  } catch (err) {
    logger.error("Whisper failed: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ /update-json
app.post("/update-json", bodyParser.json(), async (req, res) => {
  const { instruction, original } = req.body;

  try {
    const updated = await updateObjectViaLLM({ instruction, original });
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ /update-class
app.post("/update-class", bodyParser.json(), async (req, res) => {
  const { instruction, original } = req.body;

  try {
    const updated = await updateObjectViaLLM({
      instruction,
      original,
      schema: ClassDetailsSchema,
      schemaName: "classUpdate",
    });
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function extractTextWithGemini(imagePath) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const imageBytes = fs.readFileSync(imagePath);
  const base64Image = imageBytes.toString('base64');

  const result = await model.generateContent([
    { text: 'Read all Arabic text from this Islamic image.' },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Image,
      },
    },
  ]);

  const response = await result.response;
  return response.text();
}

async function extractTextWithVision(imagePath) {
    try {
      const detectedText = await visionClient.textDetection(imagePath);
      const [result] = detectedText;
      const arabicText = extractFullText(result.fullTextAnnotation);
      return arabicText.map(text => text.text).join('\n');
    } catch (error) {
      console.error("Error extracting text:", error);
      return [];
    }
}

function extractFullText(fullTextAnnotation) {
  if (!fullTextAnnotation || !fullTextAnnotation.pages) {
    return "";
  }

  const fullText = [];

  fullTextAnnotation.pages.forEach((page) => {
    page.blocks.forEach((block) => {
      block.paragraphs.forEach((paragraph) => {
        let paragraphText = "";
        const detectedLanguages = new Set();
        appendLanguagesToSet(paragraph, detectedLanguages);
        paragraph.words.forEach((word) => {
          appendLanguagesToSet(word, detectedLanguages);
          word.symbols.forEach((symbol) => {
            paragraphText += symbol.text;
            appendLanguagesToSet(symbol, detectedLanguages);
            if (symbol.property && symbol.property.detectedBreak) {
              const breakType = symbol.property.detectedBreak.type;
              if (breakType === "SPACE" || breakType === "EOL_SURE_SPACE") {
                paragraphText += " ";
              } else if (breakType === "LINE_BREAK") {
                paragraphText += "\n";
              }
            }
          });
        });
        // strip \n from the end of the paragraph
        paragraphText = paragraphText.replace(/\n$/, "");
        fullText.push({
          text: paragraphText,
          languages: Array.from(detectedLanguages),
          boundingBox: paragraph.boundingBox,
        });
      });
    });
  });

  return fullText;
}

function appendLanguagesToSet(section, detectedLanguages) {
  const sectionLanguages = [];
  if (section.property && section.property.detectedLanguages) {
    section.property.detectedLanguages.forEach((language) => {
      sectionLanguages.push(language.languageCode);
    });
  }
  if (sectionLanguages.length > 0) {
    detectedLanguages.add(...sectionLanguages);
  }
}

async function translateWithOpenAI(arabicText) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: `Translate the following Arabic text into English. Use Shia formatting (e.g., 'peace be upon him/her' for the Ahlul Bayt). Also label any content that is from the Quran, Hadith, or includes names like Imam Ali (peace be upon him) and always (peace be upon him and his family) for the Prophet. The text may have footnote markers in Arabic, retain them as English numerals. Do not add any additional comments:\n\n${arabicText}`,
      },
    ],
  });

  return completion.choices[0].message.content;
}

app.post('/upload', upload.single('image'), async (req, res) => {
  const imagePath = req.file.path;
  try {
    const arabicText = await extractTextWithGemini(imagePath);
    console.log(arabicText);
    
    if (arabicText.length === 0) {
      return res.status(400).json({ error: 'No Arabic text found in the image.' });
    }

    const translation = await translateWithOpenAI(arabicText);
    fs.unlinkSync(imagePath);


    res.json({ arabic: arabicText, translation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process image.' });
  }
});

// ✅ Start server
app.listen(port, () => {
  logger.info(`🚀 Server running at http://localhost:${port}`);
});
