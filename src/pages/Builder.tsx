import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Play, Terminal, FileCode2,
  MessageSquare, RotateCcw, ChevronUp,
  Maximize2, Minimize2, Zap, Code2, Eye,
  Check, X, ChevronRight, ChevronDown, Cpu, Layers,
  CircleDot, Menu, Folder, Share, Rocket, Sparkles,
  ArrowRight, Brain, Wand2, Activity, Copy, Download,
  RefreshCw, Plus, Trash2, File, FolderOpen, GitBranch,
  Settings, Moon, Sun, Search, Package, Globe, Lock,
  Wifi, WifiOff, ChevronLeft, Hash, AlertCircle, Info,
  LayoutGrid, PanelLeft, PanelRight, Maximize, CheckCircle2,
  ExternalLink, Clock, FileText, Braces, Image, Database,
  Palette, CreditCard, LayoutTemplate, Monitor, Tablet, Smartphone,
  Square, StopCircle, List, MessageCircle, HelpCircle, Layers3,
  FileJson, FileType, Pen, ThumbsUp
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageStatus =
  | 'thinking' | 'streaming' | 'done' | 'error' | 'building' | 'questions' | 'planning' | 'plan_review';

type AgentPhase =
  | 'idle' | 'questions' | 'planning' | 'plan_review' | 'building' | 'conversational' | 'done';

type AIQuestion = {
  id: string;
  question: string;
  options?: string[];
  type: 'choice' | 'text';
  answer?: string;
};

type ImplementationStep = {
  id: string;
  label: string;
  description: string;
  status: 'pending' | 'active' | 'done' | 'error';
  filesModified?: FileModification[];
  aiMessage?: string;
  collapsed?: boolean;
};

type FileModification = {
  filename: string;
  linesAdded: number;
  linesRemoved: number;
};

type AgentStep = {
  id: string; label: string; detail?: string;
  status: 'pending' | 'active' | 'done';
};

type FullPlan = {
  summary: string;
  fileStructure: { name: string; description: string; type: 'html' | 'css' | 'js' | 'json' | 'other' }[];
  uiComponents: string[];
  features: string[];
  buildSteps: string[];
};

type Message = {
  id: string; role: 'user' | 'agent'; content: string;
  status?: MessageStatus; timestamp: Date;
  agentSteps?: AgentStep[];
  codeLines?: number;
  buildTime?: number;
  fileCount?: number;
  planCard?: { summary: string; steps: string[]; clarifyQ?: string };
  // New fields
  questions?: AIQuestion[];
  fullPlan?: FullPlan;
  implementationSteps?: ImplementationStep[];
};

type LogEntry = {
  id: string; type: 'agent' | 'system' | 'error' | 'info';
  message: string; timestamp: Date;
};

type ConsoleEntry = {
  id: string; type: 'log' | 'error' | 'warn' | 'info';
  message: string; timestamp: Date;
};

type HistoryEntry = {
  id: string; files: ProjectFile[]; label: string; timestamp: Date;
};

type ProjectFile = {
  id: string; name: string; language: string;
  content: string; isActive?: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://zenoai-1.onrender.com';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const SUGGESTIONS = [
  { icon: Package, color: 'text-indigo-500', text: 'Build a modern SaaS pricing page' },
  { icon: Palette, color: 'text-pink-500', text: 'Create a personal portfolio with animations' },
  { icon: Activity, color: 'text-emerald-500', text: 'Design a dashboard with live charts' },
  { icon: Rocket, color: 'text-amber-500', text: 'Build an app landing page with waitlist' },
  { icon: LayoutTemplate, color: 'text-blue-500', text: 'Create a multi-page website with nav' },
  { icon: CreditCard, color: 'text-violet-500', text: 'Build an e-commerce product page' },
];

const CONSOLE_INTERCEPTOR = `<script>
(function() {
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  function relay(level, args) {
    window.parent.postMessage({ type: 'ARC_CONSOLE', level, args: Array.from(args).map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)) }, '*');
  }
  ['log','error','warn','info'].forEach(k => {
    console[k] = function() { orig[k].apply(console, arguments); relay(k, arguments); };
  });
  window.onerror = (msg, _url, line) => { relay('error', [msg + ' (line ' + line + ')']); return false; };
  window.onunhandledrejection = (e) => { relay('error', ['Unhandled promise rejection: ' + e.reason]); };
})();
<\/script>`;

const LANG_MAP: Record<string, string> = {
  html: 'HTML', css: 'CSS', js: 'JavaScript', ts: 'TypeScript',
  jsx: 'React', tsx: 'React TSX', json: 'JSON', md: 'Markdown',
  py: 'Python', txt: 'Text', sh: 'Shell', sql: 'SQL',
  env: 'Env', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP',
};

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function callAI(
  prompt: string,
  maxTokens = 1500,
  systemPrompt?: string,
  onChunk?: (chunk: string, full: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch('https://zenoai-1.onrender.com/api/v1/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: `util-${Date.now()}`, message: prompt }),
    signal,
  });
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let fullText = '';
  let carryover = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const raw = carryover + decoder.decode(value, { stream: true });
    const lines = raw.split('\n');
    carryover = lines.pop() ?? '';
    for (const line of lines) {
      const chunk = extractChunkText(line);
      if (chunk) {
        fullText += chunk;
        onChunk?.(chunk, fullText);
      }
    }
  }
  return fullText;
}

// ─── Intent Detection ─────────────────────────────────────────────────────────

async function detectIntent(
  userText: string,
  hasFiles: boolean,
  conversationContext: string
): Promise<'chat' | 'build' | 'edit'> {
  const prompt = `You are an intent classifier for an AI coding agent.

Context:
- User message: "${userText}"
- Project has existing files: ${hasFiles}
- Recent conversation: ${conversationContext || 'none'}

Classify intent as EXACTLY one of:
- "build": User wants to create a new project from scratch (new app, website, tool)
- "edit": User wants to modify, fix, add to, or improve existing code (only if project has files)
- "chat": User is asking a question, wanting explanation, or general conversation

Rules:
- If no files exist, "edit" is impossible → classify as "build" or "chat"
- Short vague messages with existing files lean toward "edit"
- Explicit creation words ("build", "create", "make", "new project") → "build"

Return ONLY valid JSON, no markdown:
{"intent":"build"}`;

  try {
    const raw = await callAI(prompt, 60);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (['chat', 'build', 'edit'].includes(parsed.intent)) return parsed.intent;
    return hasFiles ? 'edit' : 'build';
  } catch {
    return hasFiles ? 'edit' : 'build';
  }
}

// ─── Generate Dynamic Questions ───────────────────────────────────────────────

async function generateQuestions(userText: string, onStream?: (partial: string) => void): Promise<AIQuestion[]> {
  const prompt = `You are an AI coding agent. The user wants to build: "${userText}"

Generate 3-4 smart contextual questions to clarify requirements before building.
Each question should have 3-4 relevant option choices.

Return ONLY valid JSON array, no markdown:
[
  {
    "id": "q1",
    "question": "What theme/style do you prefer?",
    "type": "choice",
    "options": ["Dark & minimal", "Light & clean", "Colorful & vibrant", "Professional corporate"]
  },
  {
    "id": "q2",
    "question": "What's the primary use case?",
    "type": "choice",
    "options": ["Personal project", "Business/SaaS", "Portfolio", "E-commerce"]
  }
]

Make questions specific to the user's request. Ask about theme, features, layout, data, or technical preferences. Keep options short (2-5 words each).`;

  try {
    const raw = await callAI(prompt, 400, undefined, onStream ? (_chunk, full) => onStream(full) : undefined);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// ─── Generate Full Plan ───────────────────────────────────────────────────────

async function generateFullPlan(userText: string, answers: Record<string, string>, onStream?: (partial: string) => void): Promise<FullPlan | null> {
  const answersText = Object.entries(answers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const prompt = `You are an elite AI software engineer creating a detailed implementation plan.

USER REQUEST: "${userText}"
USER PREFERENCES:
${answersText}

Generate a comprehensive implementation plan. Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence description of what you'll build and how",
  "fileStructure": [
    {"name": "index.html", "description": "Main HTML structure with semantic markup", "type": "html"},
    {"name": "styles.css", "description": "Custom styling with CSS variables and animations", "type": "css"},
    {"name": "app.js", "description": "Interactive JavaScript logic and DOM manipulation", "type": "js"}
  ],
  "uiComponents": ["Hero section with CTA", "Navigation bar", "Feature cards", "Footer"],
  "features": ["Responsive design", "Dark mode toggle", "Smooth animations", "Interactive elements"],
  "buildSteps": [
    "Set up HTML structure with semantic elements",
    "Create CSS design system with variables",
    "Implement JavaScript interactivity",
    "Add responsive breakpoints",
    "Polish animations and transitions"
  ]
}

Always include separate HTML, CSS, and JS files unless it's a truly simple single-file app. The fileStructure must reflect ALL files you'll generate.`;

  try {
    const raw = await callAI(prompt, 600, undefined, onStream ? (_chunk, full) => onStream(full) : undefined);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.summary && parsed.fileStructure) return parsed;
    return null;
  } catch {
    return null;
  }
}

// ─── Generate Implementation Steps ────────────────────────────────────────────

async function generateImplementationSteps(plan: FullPlan, userText: string): Promise<ImplementationStep[]> {
  const files = plan.fileStructure.map(f => f.name).join(', ');
  const prompt = `Given this project plan for: "${userText}"
Files to create: ${files}
Build steps: ${plan.buildSteps.join(', ')}

Generate implementation steps as an AI agent would naturally execute them. Return ONLY valid JSON array:
[
  {
    "id": "step1",
    "label": "Creating HTML structure",
    "description": "Setting up the semantic HTML layout and document structure",
    "filesModified": [{"filename": "index.html", "linesAdded": 45, "linesRemoved": 0}]
  },
  {
    "id": "step2",
    "label": "Building CSS design system",
    "description": "Implementing styles, variables, and responsive design",
    "filesModified": [{"filename": "styles.css", "linesAdded": 120, "linesRemoved": 0}]
  }
]

Create 4-6 steps. Each step's aiMessage field is a natural language description of what the AI "sees" and does.
The filesModified linesAdded/removed should be realistic numbers based on the plan.`;

  try {
    const raw = await callAI(prompt, 500);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((s: ImplementationStep) => ({ ...s, status: 'pending', collapsed: true }));
    }
    return [];
  } catch {
    // Fallback steps based on plan
    return plan.fileStructure.map((f, i) => ({
      id: `step-${i}`,
      label: `Creating ${f.name}`,
      description: f.description,
      status: 'pending' as const,
      collapsed: true,
      filesModified: [{ filename: f.name, linesAdded: 60 + i * 20, linesRemoved: 0 }],
    }));
  }
}

// ─── Build System Prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(userText: string, plan: FullPlan | null, answers: Record<string, string>, existingFiles: ProjectFile[]): string {
  const fileContext = existingFiles.length > 0
    ? `\n\nEXISTING PROJECT FILES:\n${existingFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}\n=== END FILE ===`).join('\n\n')}\n\nModify or extend these files as needed.`
    : '';

  const answersContext = Object.entries(answers).length > 0
    ? `\n\nUSER PREFERENCES:\n${Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  const planContext = plan
    ? `\n\nIMPLEMENTATION PLAN:\nFiles to create: ${plan.fileStructure.map(f => `${f.name} (${f.description})`).join(', ')}\nFeatures: ${plan.features.join(', ')}`
    : '';

  return `You are an elite AI software engineer. Build exactly what the user asks.

USER REQUEST: "${userText}"
${answersContext}
${planContext}
${fileContext}

OUTPUT FORMAT — use this EXACT format for every file:

=== FILE: path/filename.ext ===
[complete file content here]
=== END FILE ===

CRITICAL RULES:
1. Output ALL files needed — HTML, CSS, JS, and any other needed files SEPARATELY
2. NEVER combine CSS into HTML unless specifically a single-file widget
3. NEVER combine JS into HTML unless specifically a single-file widget
4. Always create: index.html, styles.css (or similar), app.js (or similar) as SEPARATE files
5. Each file must be COMPLETE — never truncate, never use placeholders, never say "continued..."
6. Files must actually work — proper imports with relative paths, correct references
7. Use modern, production-quality code — no toy examples
8. HTML should link to the CSS file with <link> and JS with <script src="">
9. Think step by step: plan the architecture first in <think>...</think> tags, then output files
10. YOU MUST OUTPUT EVERY SINGLE FILE IN THE PLAN — do not stop after 2-3 files
11. After outputting each file, immediately start the next one — never stop early
12. The last file must be followed by === END FILE === to signal completion

Generate the complete project with ALL files now. Do not stop until every file is output:`;
}

// ─── Chat System Prompt ───────────────────────────────────────────────────────

function chatSystemPrompt(userText: string, existingFiles: ProjectFile[]): string {
  const ctx = existingFiles.length > 0
    ? `Current project files: ${existingFiles.map(f => f.name).join(', ')}`
    : 'No project files yet.';

  return `You are Arc, an expert AI software engineer and technical advisor. ${ctx}

Answer the user's question clearly and concisely. If relevant, reference specific files or code.
If they're asking how to do something, give actionable advice.

User: "${userText}"`;
}

// ─── SSE Parser ───────────────────────────────────────────────────────────────

function extractChunkText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[DONE]') return '';
  const stripped = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
  if (stripped === '[DONE]') return '';
  try {
    const parsed = JSON.parse(stripped);
    return parsed.content ?? parsed.text ?? parsed.message ?? parsed.chunk ?? parsed.response ?? parsed.delta?.content ?? '';
  } catch {
    const match = stripped.match(/"(?:content|text|message|chunk|response|delta)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try { return JSON.parse('"' + match[1] + '"'); }
      catch { return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
    }
    return '';
  }
}

async function createSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/session/new`, { method: 'POST' });
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  const data = await res.json();
  return data.session_id ?? data.sessionId ?? data.id ?? data.uuid ?? `fallback-${Date.now()}`;
}

// ─── Parse Files from LLM Output ─────────────────────────────────────────────

function parseFilesFromOutput(text: string, allowPartial = false): ProjectFile[] {
  // Primary format: === FILE: name === ... === END FILE ===
  // Streaming-safe: match complete files (with END FILE) unless allowPartial
  const filePattern = allowPartial
    ? /=== FILE: (.+?) ===\n([\s\S]*?)(?:=== END FILE ===|(?==== FILE:)|$)/g
    : /=== FILE: (.+?) ===\n([\s\S]*?)=== END FILE ===/g;

  const fileMatches = [...text.matchAll(filePattern)];
  if (fileMatches.length > 0) {
    return fileMatches.map(m => {
      const name = m[1].trim();
      const content = m[2].replace(/\n?=== END FILE ===$/, '').trim();
      const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
      return { id: `file-${name}`, name, language: LANG_MAP[ext] ? ext : ext, content };
    });
  }

  // Fallback: fenced code blocks with filename hints
  // Supports: ```html:index.html or ```javascript (filename.js) or plain ```js
  const fencedWithName = [...text.matchAll(/```(?:\w+)?(?:[:\s(]+)?([^\n`]+\.\w{1,5})?\)?\n([\s\S]*?)```/g)];
  const langOnlyBlocks = [...text.matchAll(/```(\w+)\n([\s\S]*?)```/g)];

  if (fencedWithName.some(m => m[1])) {
    return fencedWithName
      .filter(m => m[2]?.trim())
      .map((m, i) => {
        const name = m[1]?.trim() || `file-${i + 1}.txt`;
        const content = m[2].trim();
        const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
        return { id: `file-${name}-${i}`, name, language: ext, content };
      });
  }

  if (langOnlyBlocks.length > 0) {
    return langOnlyBlocks
      .filter(m => m[2]?.trim())
      .map((m, i) => {
        const lang = m[1]?.toLowerCase() ?? 'txt';
        const content = m[2].trim();
        const name = lang === 'html' ? 'index.html'
          : lang === 'css' ? 'styles.css'
          : lang === 'javascript' || lang === 'js' ? 'app.js'
          : lang === 'python' || lang === 'py' ? 'main.py'
          : `file-${i + 1}.${lang}`;
        return { id: `file-${name}-${i}`, name, language: lang, content };
      });
  }

  // Last resort: bare HTML
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    const start = text.search(/<(!DOCTYPE|html)/i);
    const content = start >= 0 ? text.slice(start) : text;
    return [{ id: 'file-index', name: 'index.html', language: 'html', content }];
  }

  return [];
}

// ─── Build Preview HTML ───────────────────────────────────────────────────────

function buildPreviewHtml(files: ProjectFile[]): string {
  const htmlFile = files.find(f => f.language === 'html');
  if (!htmlFile) {
    const htmlByContent = files.find(f => f.content.includes('<html') || f.content.includes('<!DOCTYPE'));
    if (!htmlByContent) return '';
    return CONSOLE_INTERCEPTOR + htmlByContent.content;
  }

  let html = htmlFile.content;

  files.filter(f => f.language === 'css').forEach(cssFile => {
    const linkPattern = new RegExp(`<link[^>]*href=["']${cssFile.name.replace('.', '\\.')}["'][^>]*>`, 'gi');
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, `<style>${cssFile.content}</style>`);
    } else {
      html = html.replace('</head>', `<style>${cssFile.content}</style></head>`);
    }
  });

  files.filter(f => f.language === 'js').forEach(jsFile => {
    const scriptPattern = new RegExp(`<script[^>]*src=["']${jsFile.name.replace('.', '\\.')}["'][^>]*><\\/script>`, 'gi');
    if (scriptPattern.test(html)) {
      html = html.replace(scriptPattern, `<script>${jsFile.content}<\/script>`);
    } else {
      html = html.replace('</body>', `<script>${jsFile.content}<\/script></body>`);
    }
  });

  return CONSOLE_INTERCEPTOR + html;
}

// ─── Terminal Typing Effect ────────────────────────────────────────────────────

const TerminalLine = ({ text, delay = 0 }: { text: string; delay?: number }) => {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) { setStarted(true); return; }
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const iv = setInterval(() => {
      if (i <= text.length) { setDisplayed(text.slice(0, i)); i++; }
      else clearInterval(iv);
    }, 10);
    return () => clearInterval(iv);
  }, [started, text]);

  if (!started) return null;
  return (
    <span className="block">
      <span className="text-emerald-500 dark:text-emerald-400">›</span>{' '}
      <span className="text-gray-600 dark:text-gray-300">{displayed}</span>
      {displayed.length < text.length && (
        <span className="inline-block w-1.5 h-3.5 bg-emerald-500 dark:bg-emerald-400 ml-0.5 animate-pulse align-middle" />
      )}
    </span>
  );
};

// ─── Parse think tags from content ───────────────────────────────────────────

function parseThinkContent(raw: string): { thoughts: string[]; display: string } {
  const thoughts: string[] = [];
  const display = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    thoughts.push(inner.trim());
    return '';
  }).trim();
  return { thoughts, display };
}

// ─── Thought Block (collapsible) ──────────────────────────────────────────────

function ThoughtBlock({ thought }: { thought: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors font-medium"
      >
        <Brain className="w-3 h-3" />
        <span>{open ? 'Hide' : 'Show'} reasoning</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-[11px] text-violet-700 dark:text-violet-300 font-mono whitespace-pre-wrap leading-relaxed">
              {thought}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Dynamic Questions UI ─────────────────────────────────────────────────────

function QuestionsCard({ questions, onSubmit }: {
  questions: AIQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const setAnswer = (id: string, value: string) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  const allAnswered = questions.every(q => answers[q.id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm rounded-2xl overflow-hidden arc-glass"
    >
      <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] flex items-center gap-2">
        <HelpCircle className="w-4 h-4 text-violet-500" />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">A few quick questions</span>
      </div>
      <div className="px-4 py-3 space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{i + 1}. {q.question}</p>
            {q.options ? (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setAnswer(q.id, opt)}
                    className={cn(
                      'text-[11px] px-2.5 py-1 rounded-lg border transition-all font-medium',
                      answers[q.id] === opt
                        ? 'bg-violet-100 dark:bg-violet-500/20 border-violet-300 dark:border-violet-500/40 text-violet-700 dark:text-violet-300'
                        : 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-400 hover:border-violet-200 dark:hover:border-violet-500/30'
                    )}
                  >
                    {answers[q.id] === opt && <Check className="w-2.5 h-2.5 inline mr-1" />}
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                value={answers[q.id] || ''}
                onChange={e => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer…"
                className="w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 outline-none focus:border-violet-300 dark:focus:border-violet-500/40"
              />
            )}
          </div>
        ))}
        <button
          onClick={() => onSubmit(answers)}
          disabled={!allAnswered}
          className="w-full py-2 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-30 transition-opacity"
        >
          <ArrowRight className="w-3.5 h-3.5" /> Continue to Plan
        </button>
        <button
          onClick={() => onSubmit({})}
          className="w-full py-1.5 text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        >
          Skip questions
        </button>
      </div>
    </motion.div>
  );
}

// ─── Planning Collapsible ─────────────────────────────────────────────────────

function PlanningStep({ isActive, isDone }: { isActive: boolean; isDone: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [planText, setPlanText] = useState('');

  useEffect(() => {
    if (isActive) {
      const lines = [
        'Analyzing project requirements…',
        'Determining optimal file structure…',
        'Planning component architecture…',
        'Calculating feature scope…',
        'Finalizing implementation strategy…',
      ];
      let i = 0;
      const iv = setInterval(() => {
        if (i < lines.length) {
          setPlanText(lines.slice(0, i + 1).join('\n'));
          i++;
        } else {
          clearInterval(iv);
        }
      }, 600);
      return () => clearInterval(iv);
    }
  }, [isActive]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm rounded-2xl overflow-hidden arc-glass"
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/[0.04] transition-colors"
      >
        {isDone ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : isActive ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <Cpu className="w-4 h-4 text-violet-500 shrink-0" />
          </motion.div>
        ) : (
          <Layers3 className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1 text-left">
          {isDone ? 'Implementation plan ready' : isActive ? 'Creating implementation plan…' : 'Waiting to plan'}
        </span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
      </button>
      <AnimatePresence>
        {expanded && planText && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-gray-200 dark:border-white/[0.06]"
          >
            <div className="px-4 py-3 font-mono text-[11px] text-gray-600 dark:text-gray-400 space-y-1">
              {planText.split('\n').map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-violet-500">›</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Full Screen Plan UI ──────────────────────────────────────────────────────

function FullPlanReview({ plan, onApprove, onSkip }: {
  plan: FullPlan;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const fileTypeColors: Record<string, string> = {
    html: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20',
    css: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',
    js: 'text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20',
    json: 'text-green-500 bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20',
    other: 'text-gray-500 bg-gray-50 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/20',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-sm rounded-2xl overflow-hidden arc-glass border border-violet-200/50 dark:border-violet-500/20"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-500/10 dark:to-fuchsia-500/10 border-b border-violet-200/50 dark:border-violet-500/20 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
          <Wand2 className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <p className="text-xs font-bold text-gray-900 dark:text-white">Implementation Plan</p>
          <p className="text-[10px] text-gray-500">{plan.fileStructure.length} files · {plan.features.length} features</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4 max-h-96 overflow-y-auto arc-scrollbar">
        {/* Summary */}
        <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{plan.summary}</p>

        {/* File Structure */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Folder className="w-3 h-3" /> File Structure
          </p>
          <div className="space-y-1.5">
            {plan.fileStructure.map((f, i) => (
              <div key={i} className={cn('flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-[11px]', fileTypeColors[f.type])}>
                <span className="font-mono font-semibold shrink-0">{f.name}</span>
                <span className="opacity-70 leading-relaxed">{f.description}</span>
              </div>
            ))}
          </div>
        </div>

        {/* UI Components */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <LayoutGrid className="w-3 h-3" /> UI Components
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.uiComponents.map((c, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08]">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Features */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <Zap className="w-3 h-3" /> Features
          </p>
          <div className="space-y-1">
            {plan.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Build Steps */}
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
            <List className="w-3 h-3" /> Build Steps
          </p>
          <div className="space-y-1.5">
            {plan.buildSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                <span className="w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-500/20 text-[9px] font-bold text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-white/[0.06] flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 py-2 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Rocket className="w-3.5 h-3.5" /> Approve & Build
        </button>
        <button
          onClick={onSkip}
          className="px-3 py-2 rounded-xl arc-btn-3d text-xs font-medium text-gray-600 dark:text-gray-400"
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
}

// ─── Implementation Step Card ─────────────────────────────────────────────────

function ImplementationStepCard({ step }: { step: ImplementationStep }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full max-w-sm rounded-xl overflow-hidden arc-glass"
    >
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className={cn(
          'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all',
          step.status === 'done' ? 'bg-emerald-100 dark:bg-emerald-500/20 ring-1 ring-emerald-300 dark:ring-emerald-500/40' :
            step.status === 'active' ? 'bg-violet-100 dark:bg-violet-500/20 ring-1 ring-violet-300 dark:ring-violet-400/60' :
              step.status === 'error' ? 'bg-red-100 dark:bg-red-500/20 ring-1 ring-red-300 dark:ring-red-500/40' :
                'bg-gray-100 dark:bg-white/[0.04] ring-1 ring-gray-200 dark:ring-white/[0.06]'
        )}>
          {step.status === 'done' && <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />}
          {step.status === 'active' && (
            <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-violet-500" />
          )}
          {step.status === 'error' && <X className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />}
          {step.status === 'pending' && <CircleDot className="w-2.5 h-2.5 text-gray-400" />}
        </div>

        <span className={cn(
          'text-xs flex-1 text-left transition-colors',
          step.status === 'done' ? 'text-gray-500 dark:text-gray-500' :
            step.status === 'active' ? 'text-gray-900 dark:text-white font-semibold' :
              'text-gray-500 dark:text-gray-600'
        )}>
          {step.label}
        </span>

        {/* File diff badges */}
        {step.filesModified && step.filesModified.length > 0 && (step.status === 'done' || step.status === 'active') && (
          <div className="flex items-center gap-1">
            {step.filesModified.map(f => (
              <span key={f.filename} className="flex items-center gap-0.5 text-[9px] font-mono">
                {f.linesAdded > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{f.linesAdded}</span>}
                {f.linesRemoved > 0 && <span className="text-red-500 dark:text-red-400 ml-0.5">-{f.linesRemoved}</span>}
              </span>
            ))}
          </div>
        )}

        {collapsed ? <ChevronRight className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-gray-100 dark:border-white/[0.04]"
          >
            <div className="px-3 py-2.5 space-y-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{step.description}</p>
              {step.filesModified && step.filesModified.map(f => (
                <div key={f.filename} className="flex items-center gap-2 text-[10px] font-mono">
                  <FileCode2 className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-600 dark:text-gray-400">{f.filename}</span>
                  {f.linesAdded > 0 && (
                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-sm bg-emerald-500 inline-block" />
                      +{f.linesAdded}
                    </span>
                  )}
                  {f.linesRemoved > 0 && (
                    <span className="flex items-center gap-0.5 text-red-500 dark:text-red-400">
                      <span className="w-1.5 h-1.5 rounded-sm bg-red-500 inline-block" />
                      -{f.linesRemoved}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Implementation Progress Group ────────────────────────────────────────────

function ImplementationProgress({ steps, aiMessage }: { steps: ImplementationStep[]; aiMessage?: string }) {
  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;
  const allDone = steps.every(s => s.status === 'done');

  return (
    <div className="space-y-2 w-full max-w-sm">
      {/* AI message */}
      {aiMessage && (
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Brain className="w-3 h-3 text-violet-600 dark:text-violet-400" />
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed arc-glass px-3 py-2 rounded-xl rounded-tl-sm flex-1">
            {aiMessage}
          </p>
        </div>
      )}

      {/* Progress overview */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl arc-glass">
        {allDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        ) : (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <Cpu className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          </motion.div>
        )}
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-1">
          {allDone ? 'Build complete' : activeStep ? activeStep.label : 'Processing…'}
        </span>
        <span className="text-[10px] font-mono text-gray-400">{doneCount}/{steps.length}</span>
      </div>

      {/* Individual step cards */}
      {steps.map(step => (
        <ImplementationStepCard key={step.id} step={step} />
      ))}
    </div>
  );
}

// ─── Agent Step Progress (legacy for edit flows) ──────────────────────────────

function AgentProgress({ steps }: { steps: AgentStep[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;
  const allDone = steps.every(s => s.status === 'done');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm rounded-2xl overflow-hidden arc-glass">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/[0.04] transition-colors"
      >
        <motion.div animate={allDone ? {} : { rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
          {allDone
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <Cpu className="w-4 h-4 text-violet-500" />}
        </motion.div>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1 text-left">
          {allDone ? 'Build complete' : activeStep ? activeStep.label : 'Arc is building…'}
        </span>
        <span className="text-[10px] font-mono text-gray-400">{doneCount}/{steps.length}</span>
        {collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
      </button>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
              {steps.map((step, i) => (
                <div key={step.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all',
                    step.status === 'done' ? 'bg-emerald-100 dark:bg-emerald-500/20 ring-1 ring-emerald-300 dark:ring-emerald-500/40' :
                      step.status === 'active' ? 'bg-violet-100 dark:bg-violet-500/20 ring-1 ring-violet-300 dark:ring-violet-400/60 ring-offset-1 dark:ring-offset-black/30' :
                        'bg-gray-100 dark:bg-white/[0.04] ring-1 ring-gray-200 dark:ring-white/[0.06]'
                  )}>
                    {step.status === 'done' && <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />}
                    {step.status === 'active' && (
                      <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
                        className="w-2 h-2 rounded-full bg-violet-500" />
                    )}
                    {step.status === 'pending' && <span className="text-[9px] font-bold text-gray-400">{i + 1}</span>}
                  </div>
                  <span className={cn(
                    'text-sm flex-1 transition-colors',
                    step.status === 'done' ? 'text-gray-400 dark:text-gray-600' :
                      step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' :
                        'text-gray-400 dark:text-gray-600'
                  )}>{step.label}</span>
                  {step.detail && step.status === 'active' && (
                    <span className="text-[10px] font-mono text-violet-500 dark:text-violet-400 truncate max-w-[100px]">{step.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Thinking Dots ────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl arc-glass w-fit">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-violet-500/60 dark:bg-violet-400/60"
          animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
      ))}
    </div>
  );
}

// ─── Streaming Message ────────────────────────────────────────────────────────

function StreamingMessage({ content }: { content: string }) {
  const { thoughts, display } = parseThinkContent(content);
  const midThink = /<think>/i.test(content) && !/<\/think>/i.test(content);
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
      className="max-w-[80%] flex flex-col gap-1.5">
      {thoughts.map((t, i) => <ThoughtBlock key={i} thought={t} />)}
      {midThink && (
        <div className="flex items-center gap-1.5 text-[11px] text-violet-500 dark:text-violet-400 font-medium">
          <Brain className="w-3 h-3 animate-pulse" />
          <span>Thinking…</span>
        </div>
      )}
      {display && (
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
          {display}
          <span className="inline-block w-1.5 h-3.5 bg-violet-500/60 ml-0.5 animate-pulse align-middle rounded-sm" />
        </div>
      )}
      {!display && !midThink && (
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300">
          <span className="inline-block w-1.5 h-3.5 bg-violet-500/60 animate-pulse align-middle rounded-sm" />
        </div>
      )}
    </motion.div>
  );
}

// ─── File Tree ────────────────────────────────────────────────────────────────

function FileTree({ files, activeFileId, onSelectFile, onDeleteFile, onAddFile }: {
  files: ProjectFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onAddFile: (name: string) => void;
}) {
  const [addingFile, setAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingFile) inputRef.current?.focus();
  }, [addingFile]);

  const commitAdd = () => {
    const name = newFileName.trim();
    if (name) onAddFile(name);
    setNewFileName('');
    setAddingFile(false);
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['html'].includes(ext)) return <Globe className="w-3 h-3 text-orange-500 dark:text-orange-400" />;
    if (['css', 'scss', 'sass'].includes(ext)) return <Braces className="w-3 h-3 text-blue-500 dark:text-blue-400" />;
    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return <FileCode2 className="w-3 h-3 text-yellow-500 dark:text-yellow-400" />;
    if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return <Database className="w-3 h-3 text-green-500 dark:text-green-400" />;
    if (['md'].includes(ext)) return <FileText className="w-3 h-3 text-purple-500 dark:text-purple-400" />;
    if (['png', 'jpg', 'svg', 'gif'].includes(ext)) return <Image className="w-3 h-3 text-pink-500 dark:text-pink-400" />;
    if (['py', 'rb', 'go', 'rs', 'php'].includes(ext)) return <Code2 className="w-3 h-3 text-teal-500 dark:text-teal-400" />;
    if (['sh', 'bash'].includes(ext)) return <Terminal className="w-3 h-3 text-gray-500" />;
    return <File className="w-3 h-3 text-gray-500 dark:text-gray-400" />;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#080808]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-yellow-500 dark:text-yellow-400" />
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Files</span>
        </div>
        <button onClick={() => setAddingFile(true)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors" title="New file">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files.map(f => (
          <div key={f.id} onClick={() => onSelectFile(f.id)}
            className={cn(
              'group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all',
              activeFileId === f.id
                ? 'bg-black/5 dark:bg-white/[0.08] text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/[0.04] hover:text-gray-900 dark:hover:text-gray-200'
            )}>
            {getFileIcon(f.name)}
            <span className="text-[12px] flex-1 truncate font-mono">{f.name}</span>
            <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {addingFile && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <File className="w-3 h-3 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitAdd();
                if (e.key === 'Escape') { setAddingFile(false); setNewFileName(''); }
              }}
              onBlur={commitAdd}
              placeholder="filename.ext"
              className="flex-1 bg-white dark:bg-white/[0.06] border border-violet-400/50 rounded px-2 py-0.5 text-[12px] font-mono text-gray-900 dark:text-white outline-none"
            />
          </div>
        )}

        {files.length === 0 && !addingFile && (
          <div className="px-3 py-4 text-center text-[11px] text-gray-500 italic">No files yet</div>
        )}
      </div>
    </div>
  );
}

// ─── Code Editor ──────────────────────────────────────────────────────────────

function CodeEditor({ file, onChange }: { file: ProjectFile; onChange: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScroll = () => {
    if (lineNumbersRef.current && textareaRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lines = file.content.split('\n');
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#111]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-500">{file.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/[0.06] text-gray-500">{LANG_MAP[file.language] ?? file.language.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-600">{lines.length} lines</span>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-black/5 dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-400 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          <div ref={lineNumbersRef} className="w-10 bg-gray-100 dark:bg-[#080808] border-r border-gray-200 dark:border-white/[0.04] text-right py-4 px-2 shrink-0 overflow-hidden pointer-events-none select-none">
            {lines.map((_, i) => (
              <div key={i} className="text-[11px] font-mono text-gray-400 dark:text-gray-700 leading-5">{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={file.content}
            onChange={e => onChange(e.target.value)}
            onScroll={handleScroll}
            spellCheck={false}
            className="flex-1 bg-transparent text-[12px] font-mono text-gray-800 dark:text-gray-300 leading-5 resize-none outline-none px-4 py-4 overflow-auto"
            style={{ tabSize: 2 }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Builder Component ────────────────────────────────────────────────────

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentPage, setCurrentPage] = useState('Builder');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs' | 'code'>('preview');
  const { theme } = useTheme();

  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  useEffect(() => {
    setIsDark(theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, [theme]);

  const [previewCode, setPreviewCode] = useState('');
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showFileTree, setShowFileTree] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 'init', type: 'system', message: 'Arc dev server ready.', timestamp: new Date() },
  ]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isOnline, setIsOnline] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tokenCount, setTokenCount] = useState(0);
  const [buildTime, setBuildTime] = useState<number | null>(null);
  const [showShareToast, setShowShareToast] = useState(false);

  // New state for agent workflow
  const [pendingBuildText, setPendingBuildText] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<FullPlan | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<Record<string, string>>({});
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const buildStartRef = useRef<number>(0);
  const projectFilesRef = useRef<ProjectFile[]>([]);

  useEffect(() => { projectFilesRef.current = projectFiles; }, [projectFiles]);

  // ── Online status ─────────────────────────────────────────────────────────
  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  // ── Mobile detect ──────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  // ── Console message handler ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'ARC_CONSOLE') {
        const { level, args } = e.data;
        setConsoleLogs(prev => [...prev, {
          id: Date.now().toString(),
          type: level as ConsoleEntry['type'],
          message: args.join(' '),
          timestamp: new Date(),
        }]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); handleNewProject(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === 'Escape') { setSearchOpen(false); setIsPreviewFullscreen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [historyIndex, history]);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { id: Date.now().toString(), type, message, timestamp: new Date() }]);
  }, []);

  const updateFileContent = useCallback((id: string, content: string) => {
    setProjectFiles(prev => prev.map(f => f.id === id ? { ...f, content } : f));
  }, []);

  const deleteFile = useCallback((id: string) => {
    setProjectFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeFileId === id) setActiveFileId(next[0]?.id ?? null);
      return next;
    });
  }, [activeFileId]);

  const addFile = useCallback((name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
    const newFile: ProjectFile = { id: `file-${name}-${Date.now()}`, name, language: ext, content: '' };
    setProjectFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
  }, []);

  const handleDownload = () => {
    if (projectFiles.length === 0) return;
    projectFiles.forEach(file => {
      const blob = new Blob([file.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    });
    addLog('system', 'Project downloaded.');
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  // ── History ────────────────────────────────────────────────────────────────
  const pushHistory = useCallback((files: ProjectFile[], label: string) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, { id: Date.now().toString(), files: JSON.parse(JSON.stringify(files)), label, timestamp: new Date() }];
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [historyIndex]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const entry = history[historyIndex - 1];
    setHistoryIndex(i => i - 1);
    setProjectFiles(entry.files);
    const html = entry.files.find(f => f.language === 'html');
    if (html) setPreviewCode(buildPreviewHtml(entry.files));
    addLog('system', `Reverted to: ${entry.label}`);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const entry = history[historyIndex + 1];
    setHistoryIndex(i => i + 1);
    setProjectFiles(entry.files);
    const html = entry.files.find(f => f.language === 'html');
    if (html) setPreviewCode(buildPreviewHtml(entry.files));
    addLog('system', `Redid: ${entry.label}`);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setAgentPhase('idle');
    addLog('system', 'Stream cancelled by user.');
    setMessages(prev => prev.map(m =>
      m.status === 'building' || m.status === 'streaming' || m.status === 'planning'
        ? { ...m, status: 'done', content: m.content || 'Stopped.' }
        : m
    ));
  };

  const handleNewProject = () => {
    abortRef.current?.abort();
    setMessages([]);
    setPreviewCode('');
    setProjectFiles([]);
    setActiveFileId(null);
    setLogs([{ id: Date.now().toString(), type: 'system', message: 'New project started.', timestamp: new Date() }]);
    setConsoleLogs([]);
    setSessionId(null);
    setIsStreaming(false);
    setHistory([]);
    setHistoryIndex(-1);
    setTokenCount(0);
    setBuildTime(null);
    setPendingBuildText(null);
    setPendingPlan(null);
    setPendingAnswers({});
    setAgentPhase('idle');
    if (isMobile) setMobileView('chat');
  };

  // ── Questions Handler ──────────────────────────────────────────────────────
  const handleQuestionsSubmit = async (answers: Record<string, string>) => {
    setPendingAnswers(answers);

    if (!pendingBuildText) return;

    // Remove the questions message and show planning
    setMessages(prev => prev.filter(m => m.status !== 'questions'));

    const planningMsgId = `planning-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: planningMsgId,
      role: 'agent',
      content: 'Creating implementation plan…',
      status: 'planning',
      timestamp: new Date(),
    }]);
    setAgentPhase('planning');

    addLog('agent', 'Creating implementation plan…');

    // Stream plan generation live into the planning message
    const plan = await generateFullPlan(pendingBuildText, answers, (partial) => {
      // Try to extract a summary line from partial JSON for live feedback
      const summaryMatch = partial.match(/"summary"\s*:\s*"([^"]{10,})"/);
      const filesMatch = [...partial.matchAll(/"name"\s*:\s*"([^"]+)"/g)];
      const fileNames = filesMatch.map(m => m[1]).filter(n => n.includes('.')).join(', ');
      const feedbackText = summaryMatch
        ? `Planning: ${summaryMatch[1].slice(0, 80)}…`
        : fileNames
          ? `Structuring files: ${fileNames}`
          : 'Analyzing project architecture…';
      setMessages(prev => prev.map(m =>
        m.id === planningMsgId ? { ...m, content: feedbackText } : m
      ));
    });

    if (plan) {
      setPendingPlan(plan);
      // Update to plan_review
      setMessages(prev => prev.map(m =>
        m.id === planningMsgId
          ? { ...m, status: 'plan_review', content: '', fullPlan: plan }
          : m
      ));
      setAgentPhase('plan_review');
    } else {
      // Skip plan, go straight to build
      setMessages(prev => prev.filter(m => m.id !== planningMsgId));
      await runBuild(pendingBuildText, 'build', answers, null);
    }
  };

  // ── Plan Approve Handler ───────────────────────────────────────────────────
  const handlePlanApprove = async () => {
    if (!pendingBuildText) return;
    // Keep plan visible (pinned) — just add a "building" marker below it, don't hide the plan
    setMessages(prev => prev.map(m =>
      m.status === 'plan_review' ? { ...m, status: 'done', content: '✅ Plan approved — building now…' } : m
    ));
    setAgentPhase('building');
    await runBuild(pendingBuildText, 'build', pendingAnswers, pendingPlan);
  };

  // ── Build Flow ─────────────────────────────────────────────────────────────
  const runBuild = async (
    userText: string,
    intent: 'build' | 'edit',
    answers: Record<string, string> = {},
    plan: FullPlan | null = null
  ) => {
    setIsStreaming(true);
    buildStartRef.current = Date.now();
    setActiveTab('logs');

    const buildMsgId = `build-${Date.now()}`;

    // Generate implementation steps dynamically
    let implSteps: ImplementationStep[] = [];
    if (plan) {
      implSteps = await generateImplementationSteps(plan, userText);
    } else {
      // Fallback steps
      implSteps = [
        { id: 'analyze', label: 'Analyzing requirements', description: 'Understanding your project goals', status: 'pending', collapsed: true },
        { id: 'generate', label: 'Generating files', description: 'Creating HTML, CSS, and JavaScript files', status: 'pending', collapsed: true },
        { id: 'finalize', label: 'Assembling project', description: 'Wiring files together and verifying references', status: 'pending', collapsed: true },
      ];
    }

    // AI intro message
    const aiIntroMessages = [
      `Let me look at the ${plan ? plan.fileStructure.map(f => f.name).join(', ') : 'project layout'} first`,
      `I'll start building based on your requirements`,
      `Creating a ${userText.toLowerCase().includes('dashboard') ? 'responsive dashboard' : 'modern interface'} now`,
    ];
    const aiMessage = aiIntroMessages[Math.floor(Math.random() * aiIntroMessages.length)];

    setMessages(prev => [...prev, {
      id: buildMsgId,
      role: 'agent',
      content: aiMessage,
      status: 'building',
      timestamp: new Date(),
      implementationSteps: implSteps,
    }]);

    const advanceImplStep = (stepId: string, filesModified?: FileModification[]) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.implementationSteps?.map(s => {
          if (s.status === 'active') return { ...s, status: 'done' as const };
          if (s.id === stepId) return {
            ...s,
            status: 'active' as const,
            filesModified: filesModified ?? s.filesModified,
          };
          return s;
        }) ?? [];
        return { ...m, implementationSteps: steps };
      }));
    };

    const markAllStepsDone = () => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        return {
          ...m,
          implementationSteps: m.implementationSteps?.map(s => ({ ...s, status: 'done' as const })) ?? [],
        };
      }));
    };

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      let sid = sessionId;
      if (!sid) {
        try {
          sid = await createSession();
          setSessionId(sid);
          addLog('system', `Session: ${sid.slice(0, 8)}…`);
        } catch {
          sid = `fallback-${Date.now()}`;
        }
      }

      // Start first step
      if (implSteps.length > 0) {
        advanceImplStep(implSteps[0].id);
      }
      addLog('agent', `Planning ${intent === 'edit' ? 'edits' : 'new project'}: "${userText}"`);

      const currentFiles = projectFilesRef.current;
      const prompt = buildSystemPrompt(userText, plan, answers, currentFiles);

      if (implSteps.length > 1) {
        advanceImplStep(implSteps[1].id);
      }
      addLog('agent', 'Generating code files…');

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: prompt, max_tokens: 8000 }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body reader');

      const decoder = new TextDecoder();
      let carryover = '';
      let fullText = '';
      let totalChars = 0;
      let lastParsedFileCount = 0;
      let currentStepIdx = Math.min(1, implSteps.length - 1);

      // Expected file names from plan (for completion tracking)
      const expectedFileNames = plan?.fileStructure.map(f => f.name) ?? [];

      const streamChunks = async (activeReader: ReadableStreamDefaultReader<Uint8Array>) => {
        while (true) {
          const { done, value } = await activeReader.read();
          if (done) break;

          const raw = carryover + decoder.decode(value, { stream: true });
          const lines = raw.split('\n');
          carryover = lines.pop() ?? '';

          for (const line of lines) {
            const chunk = extractChunkText(line);
            if (!chunk) continue;
            fullText += chunk;
            totalChars += chunk.length;
            setTokenCount(Math.round(totalChars / 4));

            // Real-time partial file detection (allowPartial=true for streaming)
            const partialFiles = parseFilesFromOutput(fullText, true);
            if (partialFiles.length > lastParsedFileCount) {
              const latestFile = partialFiles[partialFiles.length - 1];
              addLog('agent', `Writing ${latestFile.name}…`);

              // Update build message with current file being written
              setMessages(prev => prev.map(m =>
                m.id === buildMsgId
                  ? { ...m, content: `Writing ${latestFile.name}… (${partialFiles.length}/${Math.max(expectedFileNames.length, partialFiles.length)} files)` }
                  : m
              ));

              // Find corresponding impl step and update it
              const fileStepIdx = implSteps.findIndex(s =>
                s.filesModified?.some(f => f.filename === latestFile.name) ||
                s.label.toLowerCase().includes(latestFile.name.split('.')[0].toLowerCase())
              );

              if (fileStepIdx !== -1 && fileStepIdx !== currentStepIdx) {
                currentStepIdx = fileStepIdx;
                const lineCount = latestFile.content.split('\n').length;
                advanceImplStep(implSteps[fileStepIdx].id, [
                  { filename: latestFile.name, linesAdded: lineCount, linesRemoved: 0 }
                ]);
              } else if (currentStepIdx < implSteps.length - 1) {
                currentStepIdx++;
                advanceImplStep(implSteps[currentStepIdx].id);
              }

              lastParsedFileCount = partialFiles.length;
            }
          }
        }
      };

      await streamChunks(reader);

      // Final file parse (strict — only complete files)
      let finalFiles = parseFilesFromOutput(fullText);

      // If no complete files found but we have partial markers, use partial parse
      if (finalFiles.length === 0) {
        finalFiles = parseFilesFromOutput(fullText, true);
      }

      // Check for missing expected files and retry once
      if (expectedFileNames.length > 0 && finalFiles.length < expectedFileNames.length && !abort.signal.aborted) {
        const generatedNames = new Set(finalFiles.map(f => f.name));
        const missingFiles = expectedFileNames.filter(n => !generatedNames.has(n));

        if (missingFiles.length > 0) {
          addLog('agent', `Generating missing files: ${missingFiles.join(', ')}…`);
          setMessages(prev => prev.map(m =>
            m.id === buildMsgId ? { ...m, content: `Completing missing files: ${missingFiles.join(', ')}…` } : m
          ));

          const retryPrompt = `${buildSystemPrompt(userText, plan, answers, finalFiles)}

IMPORTANT: The following files were NOT yet generated and MUST be created now:
${missingFiles.map(name => `- ${name}`).join('\n')}

Output ONLY these missing files using the === FILE: name === ... === END FILE === format. Do not repeat already generated files.`;

          try {
            const retryRes = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sid, message: retryPrompt }),
              signal: abort.signal,
            });
            if (retryRes.ok) {
              const retryReader = retryRes.body?.getReader();
              if (retryReader) {
                carryover = '';
                await streamChunks(retryReader);
                const retryFiles = parseFilesFromOutput(fullText);
                if (retryFiles.length > finalFiles.length) {
                  finalFiles = retryFiles;
                }
              }
            }
          } catch {
            // Retry failed — proceed with what we have
            addLog('agent', 'Retry complete — proceeding with available files.');
          }
        }
      }

      if (finalFiles.length === 0) {
        throw new Error('No files found in AI response. Try rephrasing your request.');
      }

      // Merge with existing files for edits
      if (intent === 'edit' && currentFiles.length > 0) {
        const merged = [...currentFiles];
        finalFiles.forEach(newFile => {
          const existingIdx = merged.findIndex(f => f.name === newFile.name);
          if (existingIdx !== -1) merged[existingIdx] = newFile;
          else merged.push(newFile);
        });
        finalFiles = merged;
      }

      // Update impl steps with real line counts
      if (implSteps.length > 0) {
        const lastStep = implSteps[implSteps.length - 1];
        advanceImplStep(lastStep.id, finalFiles.map(f => ({
          filename: f.name,
          linesAdded: f.content.split('\n').length,
          linesRemoved: 0,
        })));
      }

      setProjectFiles(finalFiles);
      if (finalFiles.length > 0) setActiveFileId(finalFiles[0].id);

      const preview = buildPreviewHtml(finalFiles);
      if (preview) {
        setPreviewCode(preview);
      } else if (fullText.includes('<html') || fullText.includes('<!DOCTYPE')) {
        const start = fullText.search(/<(!DOCTYPE|html)/i);
        const rawHtml = start >= 0 ? fullText.slice(start) : fullText;
        setPreviewCode(CONSOLE_INTERCEPTOR + rawHtml);
      }

      const elapsed = Math.round((Date.now() - buildStartRef.current) / 1000);
      setBuildTime(elapsed);
      pushHistory(finalFiles, userText.slice(0, 40));
      const lineCount = finalFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0);

      markAllStepsDone();
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        return {
          ...m, status: 'done',
          content: `Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} · ${lineCount} lines · ${elapsed}s`,
          codeLines: lineCount, buildTime: elapsed, fileCount: finalFiles.length,
        };
      }));

      addLog('system', `Done: ${finalFiles.length} files, ${lineCount} lines in ${elapsed}s.`);
      setActiveTab('preview');
      if (isMobile) setMobileView('preview');
      setShowFileTree(true);
      if (finalFiles.length > 0) setActiveFileId(finalFiles[0].id);
      setAgentPhase('done');

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', errMsg);
      setMessages(prev => prev.map(m =>
        m.id === buildMsgId
          ? {
            ...m, status: 'error', content: `Build failed: ${errMsg}`,
            implementationSteps: m.implementationSteps?.map(s =>
              s.status === 'active' ? { ...s, status: 'error' as const } : s
            )
          }
          : m
      ));
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Chat Stream ────────────────────────────────────────────────────────────
  const runChat = async (userText: string) => {
    const chatMsgId = `chat-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: chatMsgId, role: 'agent', content: '', status: 'streaming', timestamp: new Date(),
    }]);
    setIsStreaming(true);

    try {
      const sid = sessionId || `fallback-${Date.now()}`;
      const prompt = chatSystemPrompt(userText, projectFilesRef.current);
      const abort = new AbortController();
      abortRef.current = abort;

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: prompt }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error('Failed to stream response');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let carryover = '';
      let fullText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = carryover + decoder.decode(value, { stream: true });
          const lines = raw.split('\n');
          carryover = lines.pop() ?? '';
          for (const line of lines) {
            const chunk = extractChunkText(line);
            if (chunk) {
              fullText += chunk;
              setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, content: fullText } : m));
            }
          }
        }
      }

      setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, status: 'done' } : m));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setMessages(prev => prev.map(m =>
        m.id === chatMsgId ? { ...m, content: 'Failed to get a response. Please try again.', status: 'error' } : m
      ));
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;

    // Allow chat mid-build (conversational state)
    if (isStreaming && agentPhase === 'building') {
      setInput('');
      setMessages(prev => [...prev, {
        id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date(),
      }]);
      // Queue a quick chat response without interrupting build
      const quickId = `conv-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: quickId, role: 'agent', content: 'Still building your project — I\'ll answer that right after it completes!', status: 'done', timestamp: new Date(),
      }]);
      return;
    }

    if (isStreaming) return;

    setInput('');
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date(),
    }]);

    // Show thinking indicator
    const thinkingId = `thinking-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: thinkingId, role: 'agent', content: '', status: 'thinking', timestamp: new Date(),
    }]);

    const ctx = messages.slice(-3).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join('\n');

    let intent: 'chat' | 'build' | 'edit';
    try {
      intent = await detectIntent(text, projectFiles.length > 0, ctx);
    } catch {
      intent = projectFiles.length > 0 ? 'edit' : 'build';
    }

    setMessages(prev => prev.filter(m => m.id !== thinkingId));

    if (intent === 'chat') {
      await runChat(text);
    } else if (intent === 'build' && projectFiles.length === 0) {
      // NEW FLOW: Questions (streamed) → Planning (streamed) → Plan Review → Build
      setPendingBuildText(text);
      setAgentPhase('questions');

      setMessages(prev => [...prev, {
        id: `arc-intro-${Date.now()}`,
        role: 'agent',
        content: "Generating questions…",
        status: 'streaming',
        timestamp: new Date(),
      }]);

      const introMsgId = `arc-intro-${Date.now() - 1}`;

      // Stream questions generation live
      const questionsStreamId = `q-stream-${Date.now()}`;
      setMessages(prev => prev.map(m =>
        m.status === 'streaming' ? { ...m, id: questionsStreamId, content: '⚙️ Analyzing your request…' } : m
      ));

      const questions = await generateQuestions(text, (partial) => {
        // Try to parse partial JSON to show question count
        const partialQuestions = (() => { try { return JSON.parse(partial); } catch { return null; } })();
        const qCount = Array.isArray(partialQuestions) ? partialQuestions.length : 0;
        setMessages(prev => prev.map(m =>
          m.id === questionsStreamId
            ? { ...m, content: qCount > 0 ? `Preparing ${qCount} question${qCount !== 1 ? 's' : ''}…` : '⚙️ Analyzing your request…' }
            : m
        ));
      });

      // Replace streaming message with final intro
      setMessages(prev => prev.map(m =>
        m.id === questionsStreamId
          ? { ...m, content: "I need a few details before I start building", status: 'done' }
          : m
      ));

      if (questions.length > 0) {
        setMessages(prev => [...prev, {
          id: `questions-${Date.now()}`,
          role: 'agent',
          content: '',
          status: 'questions',
          timestamp: new Date(),
          questions,
        }]);
      } else {
        // No questions needed — go straight to planning
        await handleQuestionsSubmit({});
      }
    } else {
      await runBuild(text, intent as 'build' | 'edit');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const activeFile = projectFiles.find(f => f.id === activeFileId) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        .arc-glass { background: var(--arc-glass-bg, rgba(255,255,255,0.8)); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--arc-glass-border, rgba(0,0,0,0.08)); box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
        .dark .arc-glass { --arc-glass-bg: rgba(18,18,20,0.75); --arc-glass-border: rgba(255,255,255,0.08); box-shadow: 0 4px 32px rgba(0,0,0,0.4); }
        .arc-btn-3d { background: var(--arc-btn-bg, rgba(255,255,255,0.9)); border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: all 0.15s ease; }
        .dark .arc-btn-3d { --arc-btn-bg: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.08); box-shadow: 0 1px 4px rgba(0,0,0,0.3); }
        .arc-btn-3d:hover { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.12); }
        .arc-btn-3d:active { transform: translateY(0); }
        .arc-btn-3d-primary { background: linear-gradient(180deg, rgba(139,92,246,0.9) 0%, rgba(109,40,217,0.85) 100%); box-shadow: 0 2px 10px rgba(139,92,246,0.3); transition: all 0.15s ease; border: none; }
        .arc-btn-3d-primary:hover { box-shadow: 0 4px 15px rgba(139,92,246,0.4); transform: translateY(-1px); }
        .arc-btn-3d-primary:disabled { opacity: 0.35; transform: none; }
        .arc-input-glass { background: var(--arc-glass-bg); border: 1px solid var(--arc-glass-border); box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .dark .arc-input-glass { box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .arc-input-glass:focus-within { border-color: rgba(139,92,246,0.4); box-shadow: 0 0 0 3px rgba(139,92,246,0.12); }
        .arc-scrollbar::-webkit-scrollbar { width: 4px; }
        .arc-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .arc-scrollbar::-webkit-scrollbar-thumb { background: rgba(156,163,175,0.3); border-radius: 4px; }
        .dark .arc-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
      `}</style>

      <div className={cn("flex h-screen overflow-hidden transition-colors duration-300", isDark ? 'dark bg-[#060608] text-white' : 'bg-gray-50 text-gray-900')}>

        {/* Sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setSidebarOpen(false)}
                className="fixed inset-0 z-40 bg-black/20 dark:bg-black/60 backdrop-blur-sm" />
              <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
                transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                className="fixed left-0 top-0 bottom-0 w-64 z-50 arc-glass border-r border-gray-200 dark:border-white/[0.08] shadow-2xl">
                <Sidebar currentPage={currentPage}
                  setCurrentPage={(page) => { setCurrentPage(page); setSidebarOpen(false); }}
                  isOpen={true} onClose={() => setSidebarOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Command palette */}
        <AnimatePresence>
          {searchOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setSearchOpen(false)}
                className="fixed inset-0 z-50 bg-black/20 dark:bg-black/70 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.96, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -20 }}
                className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-md z-50 bg-white dark:bg-[#111] border border-gray-200 dark:border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search commands…"
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 outline-none" />
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-500">ESC</kbd>
                </div>
                <div className="p-2">
                  {[
                    { icon: Plus, label: 'New project', shortcut: '⌘N', action: () => { handleNewProject(); setSearchOpen(false); } },
                    { icon: Download, label: 'Download files', shortcut: '', action: () => { handleDownload(); setSearchOpen(false); } },
                    { icon: Share, label: 'Copy project URL', shortcut: '', action: () => { handleShare(); setSearchOpen(false); } },
                    { icon: RotateCcw, label: 'Undo last build', shortcut: '⌘Z', action: () => { handleUndo(); setSearchOpen(false); } },
                  ].filter(c => !searchQuery || c.label.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(cmd => (
                      <button key={cmd.label} onClick={cmd.action}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors text-left">
                        <cmd.icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{cmd.label}</span>
                        {cmd.shortcut && <kbd className="text-[10px] text-gray-400">{cmd.shortcut}</kbd>}
                      </button>
                    ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Share toast */}
        <AnimatePresence>
          {showShareToast && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#111] border border-gray-200 dark:border-white/10 text-sm text-gray-900 dark:text-white shadow-xl">
              <Check className="w-4 h-4 text-emerald-500" /> URL copied — note: state is not saved yet
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main layout */}
        <div className="flex flex-col flex-1 min-w-0 h-full">

          {/* Top bar */}
          <div className="h-12 shrink-0 border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-2 bg-white/80 dark:bg-black/40 backdrop-blur-xl">
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg arc-btn-3d">
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-sm tracking-tight text-gray-900 dark:text-white">Arc</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-600 border border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30">AI</span>
            </div>

            <div className="flex items-center gap-1.5 ml-1">
              <div className={cn('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-red-500')} />
              <span className="text-[10px] text-gray-500 font-mono hidden sm:block">{isOnline ? 'online' : 'offline'}</span>
            </div>

            {isStreaming && tokenCount > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 font-mono ml-2">
                <Activity className="w-3 h-3 animate-pulse" />
                ~{tokenCount.toLocaleString()} tokens
              </div>
            )}

            {buildTime && !isStreaming && (
              <div className="flex items-center gap-1 text-[10px] text-gray-500 font-mono ml-2">
                <Clock className="w-3 h-3" />
                {buildTime}s
              </div>
            )}

            {/* Agent phase indicator */}
            {agentPhase !== 'idle' && agentPhase !== 'done' && (
              <div className={cn(
                'flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full ml-2',
                agentPhase === 'questions' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                  agentPhase === 'planning' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                    agentPhase === 'plan_review' ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400' :
                      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              )}>
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                  <CircleDot className="w-2.5 h-2.5" />
                </motion.div>
                {agentPhase === 'questions' ? 'Gathering info' :
                  agentPhase === 'planning' ? 'Planning' :
                    agentPhase === 'plan_review' ? 'Review plan' :
                      'Building'}
              </div>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5">
              <button onClick={() => setSearchOpen(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg arc-btn-3d">
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Search</span>
                <kbd className="text-[10px] text-gray-400 hidden sm:block">⌘K</kbd>
              </button>
              {history.length > 1 && (
                <>
                  <button onClick={handleUndo} disabled={historyIndex <= 0}
                    className="p-1.5 rounded-lg arc-btn-3d disabled:opacity-30" title="Undo">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleRedo} disabled={historyIndex >= history.length - 1}
                    className="p-1.5 rounded-lg arc-btn-3d disabled:opacity-30" title="Redo">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {(previewCode || projectFiles.length > 0) && (
                <>
                  <button onClick={handleDownload}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg arc-btn-3d">
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:block">Download</span>
                  </button>
                  <button onClick={handleShare} className="p-1.5 rounded-lg arc-btn-3d" title="Copy project URL">
                    <Share className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={handleNewProject}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg arc-btn-3d">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:block">New</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0 relative">

            {/* Chat panel */}
            <div className={cn(
              'flex flex-col h-full transition-all duration-500 border-r border-gray-200 dark:border-white/[0.06]',
              isMobile ? 'w-full' : messages.length > 0 ? 'w-[400px] shrink-0' : 'flex-1'
            )}>
              {/* Messages */}
              <div className={cn(
                'flex-1 overflow-y-auto arc-scrollbar px-4 py-6 space-y-4',
                isMobile && mobileView === 'preview' ? 'hidden' : ''
              )}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-8">
                    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-600/5 dark:bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4 relative">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-500/40">
                        <Zap className="w-8 h-8 text-white" />
                      </div>
                      <div className="text-center">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Arc AI Agent</h1>
                        <p className="text-sm text-gray-500 mt-1">Describe what to build — I'll generate all the files</p>
                      </div>
                    </motion.div>

                    <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                      {SUGGESTIONS.map((s, i) => {
                        const Icon = s.icon;
                        return (
                          <motion.button key={i}
                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.07 }}
                            onClick={() => { setInput(s.text); textareaRef.current?.focus(); }}
                            className="text-left p-3 rounded-xl arc-btn-3d group flex flex-col gap-2">
                            <Icon className={cn('w-5 h-5', s.color)} />
                            <p className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-300 transition-colors leading-snug">{s.text}</p>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>

                        {/* User message */}
                        {msg.role === 'user' && (
                          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-tr-sm arc-btn-3d-primary text-white text-sm leading-relaxed">
                            {msg.content}
                          </motion.div>
                        )}

                        {/* Thinking */}
                        {msg.role === 'agent' && msg.status === 'thinking' && <ThinkingDots />}

                        {/* Streaming chat response */}
                        {msg.role === 'agent' && msg.status === 'streaming' && (
                          <StreamingMessage content={msg.content} />
                        )}

                        {/* Questions phase */}
                        {msg.role === 'agent' && msg.status === 'questions' && msg.questions && (
                          <QuestionsCard
                            questions={msg.questions}
                            onSubmit={handleQuestionsSubmit}
                          />
                        )}

                        {/* Planning phase - shows live streamed plan content */}
                        {msg.role === 'agent' && msg.status === 'planning' && (
                          <div className="space-y-2 w-full max-w-sm">
                            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                              className="flex items-start gap-2">
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                className="w-5 h-5 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                                <Cpu className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                              </motion.div>
                              <div className="arc-glass px-3 py-2 rounded-xl rounded-tl-sm flex-1">
                                <p className="text-xs text-gray-700 dark:text-gray-300">
                                  {msg.content || 'Creating implementation plan…'}
                                </p>
                                <span className="inline-block w-1.5 h-3 bg-violet-500/60 ml-0.5 animate-pulse align-middle rounded-sm" />
                              </div>
                            </motion.div>
                          </div>
                        )}

                        {/* Plan Review - full screen plan */}
                        {msg.role === 'agent' && msg.status === 'plan_review' && msg.fullPlan && (
                          <FullPlanReview
                            plan={msg.fullPlan}
                            onApprove={handlePlanApprove}
                            onSkip={() => {
                              if (pendingBuildText) {
                                setMessages(prev => prev.map(m =>
                                  m.id === msg.id ? { ...m, status: 'done', content: '⚡ Skipped plan — building directly…' } : m
                                ));
                                runBuild(pendingBuildText, 'build', pendingAnswers, pendingPlan);
                              }
                            }}
                          />
                        )}

                        {/* Implementation phase with steps */}
                        {msg.role === 'agent' && (msg.status === 'building' || (msg.status === 'done' && msg.implementationSteps)) && msg.implementationSteps && (
                          <ImplementationProgress
                            steps={msg.implementationSteps}
                            aiMessage={msg.status === 'building' ? msg.content : undefined}
                          />
                        )}

                        {/* Legacy agent steps (for edit mode) */}
                        {msg.role === 'agent' && msg.status === 'building' && msg.agentSteps && !msg.implementationSteps && (
                          <AgentProgress steps={msg.agentSteps} />
                        )}

                        {/* Done agent message (chat/text response) */}
                        {msg.role === 'agent' && msg.status === 'done' && !msg.planCard && !msg.questions && !msg.fullPlan && !msg.implementationSteps && msg.content && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="flex items-start gap-2.5 max-w-sm">
                            <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="flex flex-col gap-1.5 flex-1">
                              {(() => {
                                const { thoughts, display } = parseThinkContent(msg.content);
                                return (
                                  <>
                                    {thoughts.map((t, i) => <ThoughtBlock key={i} thought={t} />)}
                                    {display && (
                                      <div className="arc-glass rounded-2xl px-4 py-3 text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                                        {display}
                                        {msg.fileCount && msg.fileCount > 1 && (
                                          <div className="mt-2 flex flex-wrap gap-1">
                                            {projectFiles.map(f => (
                                              <button key={f.id} onClick={() => { setActiveFileId(f.id); setActiveTab('code'); }}
                                                className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors">
                                                {f.name}
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </motion.div>
                        )}

                        {/* Error */}
                        {msg.role === 'agent' && msg.status === 'error' && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="flex items-start gap-2.5 max-w-sm">
                            <div className="w-6 h-6 rounded-lg bg-red-100 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-2xl px-4 py-3 text-sm text-red-600 dark:text-red-300">
                              {msg.content}
                            </div>
                          </motion.div>
                        )}

                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input area */}
              <div className={cn(
                "shrink-0 p-3 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#060608]",
                isMobile ? "pb-[calc(1rem+env(safe-area-inset-bottom)+3.5rem)]" : "pb-[calc(1rem+env(safe-area-inset-bottom))]"
              )}>
                <div className={cn('flex flex-col gap-2 rounded-2xl arc-input-glass p-3')}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      isStreaming && agentPhase === 'building'
                        ? 'Ask a question while building… (won\'t interrupt)'
                        : isStreaming
                          ? 'Arc is working…'
                          : agentPhase === 'questions'
                            ? 'Answer the questions above or type something…'
                            : projectFiles.length > 0
                              ? 'Ask for changes, edits, or a new project…'
                              : 'Describe what you want to build…'
                    }
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-500 resize-none outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      {isStreaming && agentPhase === 'building' ? (
                        <span className="flex items-center gap-1 text-violet-500">
                          <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }}
                            className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                          Building in progress — chat available
                        </span>
                      ) : (
                        <>
                          <Hash className="w-3 h-3" />
                          <span>Shift+Enter for newline</span>
                        </>
                      )}
                    </div>
                    {isStreaming && agentPhase !== 'building' ? (
                      <button type="button" onClick={handleStop}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors">
                        <Square className="w-3 h-3 fill-current" /> Stop
                      </button>
                    ) : (
                      <button onClick={handleSubmit} disabled={!input.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold disabled:opacity-30">
                        <Sparkles className="w-3.5 h-3.5" />
                        {isStreaming && agentPhase === 'building' ? 'Ask' : 'Send'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Preview panel */}
            {messages.length > 0 && (
              <div className={cn(
                'flex flex-col h-full transition-all duration-500',
                isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0 z-20 pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'hidden') : 'flex-1',
                isPreviewFullscreen ? 'fixed inset-0 z-50 bg-gray-50 dark:bg-[#060608]' : ''
              )}>
                {/* Tab bar */}
                <div className="h-11 shrink-0 border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-1 bg-white/50 dark:bg-black/30 backdrop-blur-xl justify-between">
                  <div className="flex items-center gap-1">
                    {[
                      { id: 'preview', icon: Eye, label: 'Preview' },
                      { id: 'code', icon: Code2, label: `Code${projectFiles.length > 0 ? ` (${projectFiles.length})` : ''}` },
                      { id: 'console', icon: Terminal, label: `Console${consoleLogs.length ? ` (${consoleLogs.length})` : ''}` },
                      { id: 'logs', icon: Activity, label: 'Logs' },
                    ].map(tab => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                          activeTab === tab.id
                            ? 'arc-btn-3d text-gray-900 dark:text-white'
                            : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-black/5 dark:hover:bg-white/[0.04]'
                        )}>
                        <tab.icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:block">{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {activeTab === 'preview' && (
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.06]">
                        {(['desktop', 'tablet', 'mobile'] as const).map(d => (
                          <button key={d} onClick={() => setPreviewDevice(d)}
                            className={cn('p-1.5 rounded-md transition-all',
                              previewDevice === d ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-white shadow-sm' : 'text-gray-400 hover:text-gray-600')}>
                            {d === 'desktop' ? <Monitor className="w-3.5 h-3.5" /> : d === 'tablet' ? <Tablet className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {activeTab === 'code' && projectFiles.length > 0 && (
                      <button onClick={() => setShowFileTree(f => !f)}
                        className={cn('p-1.5 rounded-lg transition-colors', showFileTree ? 'arc-btn-3d' : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300')}>
                        <PanelLeft className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => setIsPreviewFullscreen(f => !f)} className="p-1.5 rounded-lg arc-btn-3d">
                      {isPreviewFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Content area */}
                <div className="flex flex-1 min-h-0 bg-gray-50 dark:bg-[#060608]">

                  {/* File tree sidebar */}
                  {activeTab === 'code' && showFileTree && projectFiles.length > 0 && (
                    <div className="w-44 shrink-0 border-r border-gray-200 dark:border-white/[0.06]">
                      <FileTree files={projectFiles} activeFileId={activeFileId}
                        onSelectFile={setActiveFileId} onDeleteFile={deleteFile} onAddFile={addFile} />
                    </div>
                  )}

                  <div className="flex-1 relative overflow-hidden">

                    {/* Preview tab */}
                    {activeTab === 'preview' && (
                      <div className="w-full h-full flex flex-col items-center p-4">
                        <div className="bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-white/[0.08] shadow-2xl transition-all duration-500 flex flex-col relative"
                          style={{
                            width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px',
                            maxWidth: '100%', height: '100%',
                          }}>
                          {/* Browser chrome */}
                          <div className="h-9 shrink-0 bg-gray-100 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-2">
                            <div className="flex gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                              <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                            </div>
                            <div className="mx-auto flex-1 max-w-xs h-5 bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-transparent rounded-md flex items-center justify-center text-[10px] text-gray-500 font-mono">
                              localhost:3000
                            </div>
                            {previewCode && (
                              <button onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(previewCode); w.document.close(); } }}
                                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 transition-colors" title="Open in new tab">
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          <div className="relative flex-1 bg-white">
                            <AnimatePresence>
                              {isStreaming && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                  className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-[#060608]/90 backdrop-blur-sm">
                                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                    className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                                    <Zap className="w-6 h-6 text-white" />
                                  </motion.div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-gray-300 mt-4">Building your project…</p>
                                  <p className="text-xs text-gray-500 mt-1 font-mono">{tokenCount > 0 ? `~${tokenCount.toLocaleString()} tokens` : 'Connecting…'}</p>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            {previewCode
                              ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                              : !isStreaming && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                                  <Play className="w-8 h-8 opacity-20" />
                                  <span className="text-sm opacity-60">Preview will appear here</span>
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Code tab */}
                    {activeTab === 'code' && (
                      <div className="w-full h-full flex flex-col">
                        {projectFiles.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                            <FileCode2 className="w-8 h-8 opacity-40" />
                            <span className="text-sm opacity-80">No files yet</span>
                          </div>
                        ) : activeFile ? (
                          <CodeEditor file={activeFile} onChange={(content) => updateFileContent(activeFile.id, content)} />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                            <FileCode2 className="w-8 h-8 opacity-40" />
                            <span className="text-sm">Select a file to view</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Console tab */}
                    {activeTab === 'console' && (
                      <div className="w-full h-full bg-white dark:bg-[#080808] text-gray-800 dark:text-gray-300 font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        {consoleLogs.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 dark:text-gray-600">
                            <Terminal className="w-6 h-6 opacity-30" />
                            <span className="text-xs">No console output yet</span>
                            <span className="text-[10px] opacity-60">Errors and logs from your preview will appear here</span>
                          </div>
                        ) : (
                          consoleLogs.map((log) => (
                            <div key={log.id} className={cn('flex gap-2 mb-1.5',
                              log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-amber-500' : '')}>
                              <span className="text-gray-400 shrink-0">{log.timestamp.toLocaleTimeString()}</span>
                              <span className="whitespace-pre-wrap break-words">{log.message}</span>
                            </div>
                          ))
                        )}
                        <div ref={consoleEndRef} />
                      </div>
                    )}

                    {/* Logs tab */}
                    {activeTab === 'logs' && (
                      <div className="w-full h-full bg-white dark:bg-[#080808] font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        <div className="mb-3 flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-violet-500" />
                          <span className="text-violet-600 dark:text-violet-400 font-semibold">Arc Terminal</span>
                        </div>
                        {logs.map((log, i) => (
                          <div key={log.id} className={cn(
                            'flex gap-2 mb-1.5 leading-relaxed',
                            log.type === 'system' ? 'text-emerald-600 dark:text-emerald-400' :
                              log.type === 'error' ? 'text-red-600 dark:text-red-400' :
                                log.type === 'info' ? 'text-blue-600 dark:text-blue-400' :
                                  'text-gray-800 dark:text-gray-400'
                          )}>
                            <span className="shrink-0 text-gray-400 dark:text-gray-600">{log.timestamp.toLocaleTimeString()}</span>
                            <span className="shrink-0 text-gray-500 dark:text-gray-700">[{log.type.slice(0, 3)}]</span>
                            {log.type === 'agent' && i >= logs.length - 3 ? (
                              <TerminalLine text={log.message} delay={0} />
                            ) : (
                              <span className="whitespace-pre-wrap break-words">{log.message}</span>
                            )}
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    )}

                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile bottom nav */}
        {isMobile && (
          <div className="fixed bottom-0 left-0 right-0 h-14 border-t border-gray-200 dark:border-white/[0.06] flex bg-white/90 dark:bg-black/80 backdrop-blur-xl z-30 pb-[env(safe-area-inset-bottom)]">
            <button onClick={() => setMobileView('chat')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'chat' ? 'text-violet-600 dark:text-white' : 'text-gray-500')}>
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button onClick={() => setMobileView('preview')}
              disabled={messages.length === 0}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'preview' ? 'text-violet-600 dark:text-white' : messages.length === 0 ? 'text-gray-300 dark:text-gray-700' : 'text-gray-500')}>
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>
        )}
      </div>
    </>
  );
}
