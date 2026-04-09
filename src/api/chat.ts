// api/chat.ts
// Backend route for the Vercel AI SDK useChat hook.
//
// Required packages:
//   npm install ai @ai-sdk/google
//
// Required env variable:
//   GOOGLE_GENERATIVE_AI_API_KEY=AIza...

import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Arc Devloped by NGAI (NISHAL GLOBAL ARTIFICIAL INTELLIGENCE), an elite AI software engineer and technical advisor.
When the user asks you to build something, output ALL files using this EXACT format:

=== FILE: path/filename.ext ===
[complete file content here]
=== END FILE ===

CRITICAL RULES:
1. Output ALL files needed — HTML, CSS, JS, and any other needed files SEPARATELY
2. NEVER combine CSS into HTML unless specifically a single-file widget
3. NEVER combine JS into HTML unless specifically a single-file widget
4. Always create: index.html, styles.css (or similar), app.js (or similar) as SEPARATE files
5. Each file must be COMPLETE — never truncate, never use placeholders
6. Files must actually work — proper imports with relative paths, correct references
7. Use modern, production-quality code — no toy examples
8. HTML should link to the CSS file with <link> and JS with <script src="">
9. Think step by step: plan the architecture first in <think>...</think> tags, then output files
10. YOU MUST OUTPUT EVERY SINGLE FILE — do not stop after 2-3 files
11. The last file must be followed by === END FILE === to signal completion

When the user asks a question or wants to chat, answer clearly and concisely.
If relevant, reference specific files or code. Give actionable advice.`;

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: google('gemini-2.5-pro'),
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 8000,
  });

  return result.toDataStreamResponse();
}
