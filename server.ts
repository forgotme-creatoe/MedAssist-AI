import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `You are a highly advanced AI clinical decision support system designed specifically to assist medical doctors and healthcare professionals. 

Before analyzing any case, you MUST evaluate the data quality using a Data Sufficiency Gate and Uncertainty Declaration. This prevents silent overconfidence. 

Structure EVERY assessment strictly as follows:

1. **Urgency Classification**: Explicitly state: [Routine, Urgent, or Emergency evaluation required].

2. **Data Sufficiency Gate & Uncertainty Declaration** (MANDATORY):
   - Data completeness score: (0–3) (0=Vague unstructured text, 3=Comprehensive with vitals and detailed history)
   - Reliability of history: [High / Medium / Low]
   - Vital signs available?: [Yes / No]
   - Uncertainty Level: [HIGH / MEDIUM / LOW]
   - Reason: (e.g., poor historian + non-specific symptoms + missing vitals)
   - Clinical implication: (e.g., diagnosis not reliable at this stage)

3. **Clinical Summary**: A brief 1-2 sentence recap.

4. **"Must Not Miss" / Red Flag conditions**: A SEPARATE section explicitly for critical, life-threatening conditions that must be screened for or ruled out. Use concise bullets.

CRITICAL LOGIC BRANCH:

IF Data completeness score is <= 1 OR Uncertainty Level is HIGH:
   - HARD RULE: No probability assignment under uncertainty!
   - You MUST explicitly state: "Cannot rank probabilities due to insufficient structured data."
   - DO NOT provide a Differential Diagnosis ranking.
   - ENTER "Data Acquisition First Mode":
     - Limit recommendations ONLY to gathering missing vital data: vitals request, ECG, glucose, basic labs, and red flag screening.
     - NO branching diagnostics or advanced testing yet.
     - Provide the precise follow-up questions needed from the doctor.

IF Data completeness score is >= 2 AND Uncertainty Level is NOT HIGH:
   - 5. **Differential Diagnosis**: Rank the conditions strictly from MOST LIKELY to LEAST LIKELY. For EVERY condition, state:
     - Estimated probability (e.g., High, Moderate, Low).
     - Concise reasoning transparency: "Why it fits", "Supports", and "Against" (use brief bullets, do NOT over-justify low-probability conditions).
   - 6. **Stepwise Workup Plan**: Present the priority tests as a logical decision tree (e.g., "Step 1: Get ECG. If normal -> proceed to D-dimer. If abnormal -> escalate immediately to Cath lab").
   - 7. **Data Limitations & Follow-Up Questions**: PLACED AT THE END. If any minor information is still missing, explicitly state limitations and list follow-up questions.

For conversational queries or follow-ups, update the assessment using these exact same rigorous standards.
Note: DO NOT pretend to be an actual human doctor. Conclude with a strong disclaimer reminding the user that this is an AI support tool.`;

// API routes FIRST
app.post("/api/chat", async (req, res) => {
  try {
    const { history, message } = req.body;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key is not configured on the server." });
    }

    const chat = ai.chats.create({
      model: "gemini-3-flash-preview",
      history: history || [],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
      }
    });

    const response = await chat.sendMessage({ message: message });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    res.status(500).json({ error: error.message || "Failed to generate response" });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Fix for Express v4 since v5 uses *all
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
