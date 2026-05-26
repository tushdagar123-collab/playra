/* ══════════════════════════════════════════
   PLAYRA — AI QUESTION GENERATOR
   Provider : Groq (OpenAI-compatible API)
   Model    : llama-3.3-70b-versatile
   ══════════════════════════════════════════ */

const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ─── In-flight guard ───────────────────────────────────────────────────────
// Prevents duplicate concurrent API calls regardless of how many times the
// generate button is clicked before a response arrives.
let _isGenerating = false;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Get the Groq API key from the Vite environment.
 * @returns {string}
 * @throws {Error} if the key is missing or empty
 */
function getApiKey() {
  const key = import.meta.env.VITE_GROQ_API_KEY;
  if (!key || key.trim() === '') {
    throw new Error(
      'Groq API key is not configured. Add VITE_GROQ_API_KEY=gsk_... to your .env file and restart the dev server.'
    );
  }
  return key.trim();
}

/**
 * Build the system + user messages sent to Groq.
 * The system message enforces JSON-only output; the user message specifies
 * the quiz topic, difficulty, and count.
 * @param {string} topic
 * @param {string} difficulty - easy | medium | hard
 * @param {number} numberOfQuestions
 * @returns {{ system: string, user: string }}
 */
function buildMessages(topic, difficulty, numberOfQuestions) {
  const system = `You are a quiz question generator. \
You MUST respond with valid JSON only — no markdown, no code fences, no explanation. \
Your output must be a JSON object with a single key "questions" whose value is an array of MCQ objects.`;

  const user = `Generate ${numberOfQuestions} ${difficulty} multiple-choice quiz questions on the topic: "${topic}".

Return ONLY this JSON structure — nothing else:
{
  "questions": [
    {
      "question": "The question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "The exact text of the correct option"
    }
  ]
}

Rules:
- Each question must have exactly 4 options.
- "correctAnswer" must exactly match one of the strings in "options".
- Questions should be ${difficulty} difficulty level.`;

  return { system, user };
}

/**
 * Parse the JSON object from the Groq response text and return the questions
 * array. Handles models that still wrap output in code fences.
 * @param {string} text - Raw content from the LLM
 * @returns {Array}
 */
function extractQuestions(text) {
  if (!text || text.trim() === '') {
    throw new Error('Groq returned an empty response. Please try again.');
  }

  let cleaned = text.trim();
  // Strip optional ```json ... ``` or ``` ... ``` wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON: ${err.message}`);
  }

  // Accept { questions: [...] } wrapper or a bare array
  const arr = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(arr)) {
    throw new Error('AI response did not contain a valid questions array.');
  }
  return arr;
}

/**
 * Validate and normalise a single question object.
 * Converts the correctAnswer string → numeric index used by the game engine.
 * @param {object} q
 * @param {number} index
 * @returns {{ question: string, options: string[], correctAnswer: number }}
 */
function normalizeQuestion(q, index) {
  if (!q.question || typeof q.question !== 'string') {
    throw new Error(`Question ${index + 1} is missing the "question" field.`);
  }
  if (!Array.isArray(q.options) || q.options.length !== 4) {
    throw new Error(`Question ${index + 1} must have exactly 4 options.`);
  }
  if (!q.correctAnswer || typeof q.correctAnswer !== 'string') {
    throw new Error(`Question ${index + 1} is missing the "correctAnswer" field.`);
  }

  // Exact match
  const correctIndex = q.options.findIndex(
    opt => opt.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()
  );

  if (correctIndex !== -1) {
    return {
      question:      q.question.trim(),
      options:       q.options.map(o => o.trim()),
      correctAnswer: correctIndex,
    };
  }

  // Partial match fallback
  const partialIndex = q.options.findIndex(
    opt =>
      opt.trim().toLowerCase().includes(q.correctAnswer.trim().toLowerCase()) ||
      q.correctAnswer.trim().toLowerCase().includes(opt.trim().toLowerCase())
  );

  if (partialIndex === -1) {
    console.warn(
      `[Groq] Q${index + 1}: correctAnswer "${q.correctAnswer}" not found in options. Defaulting to 0.`
    );
  }

  return {
    question:      q.question.trim(),
    options:       q.options.map(o => o.trim()),
    correctAnswer: partialIndex === -1 ? 0 : partialIndex,
  };
}

/** Sleep `ms` milliseconds — used for retry back-off. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Core API call ─────────────────────────────────────────────────────────

/**
 * Execute one Groq chat-completions request.
 * @param {string} system - System prompt
 * @param {string} user   - User prompt
 * @param {string} apiKey
 * @returns {Promise<string>} Raw text from the first choice
 */
async function callGroqAPI(system, user, apiKey) {
  const body = {
    model:       GROQ_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
    temperature:      0.7,
    max_tokens:       4096,
    response_format:  { type: 'json_object' },
  };

  let response;
  try {
    response = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Network error connecting to Groq: ${networkErr.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');

    if (response.status === 401) {
      throw new Error(
        'Invalid Groq API key. Check VITE_GROQ_API_KEY in your .env file.'
      );
    }
    if (response.status === 403) {
      throw new Error(
        'Groq API access denied. Verify your API key permissions at console.groq.com.'
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Groq model "${GROQ_MODEL}" not found. Ensure your account has access to this model.`
      );
    }
    if (response.status === 429) {
      const rateLimitErr = new Error('Groq API rate limit reached. Retrying shortly…');
      rateLimitErr.isRateLimit = true;
      throw rateLimitErr;
    }

    throw new Error(`Groq API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(
      'Groq returned no content. The response may have been filtered. Try a different topic.'
    );
  }

  return text;
}

// ─── Public export ─────────────────────────────────────────────────────────

/**
 * Generate MCQ questions using Groq Llama with automatic 429 retry.
 *
 * Exported as `generateWithGemini` to keep all existing callers (quiz-editor.js)
 * unchanged — the name refers to the generation capability, not the provider.
 *
 * Protected by a module-level `_isGenerating` flag: any call while one is
 * already in flight throws immediately without firing a duplicate HTTP request.
 *
 * @param {string} topic
 * @param {string} difficulty - easy | medium | hard
 * @param {number} numberOfQuestions
 * @returns {Promise<Array<{ question: string, options: string[], correctAnswer: number }>>}
 * @throws {Error} if already generating, API key is missing, or all retries fail
 */
export async function generateWithGemini(topic, difficulty, numberOfQuestions) {
  if (_isGenerating) {
    throw new Error('A generation is already in progress. Please wait.');
  }

  _isGenerating = true;

  try {
    const apiKey = getApiKey();
    const { system, user } = buildMessages(topic, difficulty, numberOfQuestions);

    // Retry loop: up to 3 attempts with exponential back-off for 429 errors
    const MAX_RETRIES = 3;
    const BASE_DELAY  = 2000; // ms

    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const text = await callGroqAPI(system, user, apiKey);

        const rawQuestions = extractQuestions(text);
        if (rawQuestions.length === 0) {
          throw new Error('Groq returned an empty question list. Please try again.');
        }

        return rawQuestions.map((q, i) => normalizeQuestion(q, i));

      } catch (err) {
        lastError = err;

        if (err.isRateLimit && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt - 1); // 2s → 4s → 8s
          console.warn(
            `[Groq] Rate limited. Retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})…`
          );
          await sleep(delay);
          continue;
        }

        // Non-retryable or final attempt — re-throw immediately
        throw err;
      }
    }

    throw lastError; // All retries exhausted

  } finally {
    _isGenerating = false;
  }
}
