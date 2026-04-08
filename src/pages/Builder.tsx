import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Play, Terminal, FileCode2,
  MessageSquare, ChevronRight, ChevronDown, Cpu, Check, X,
  CircleDot, Folder, Share, Rocket, Sparkles,
  ArrowRight, Brain, Wand2, Activity, Copy, Download,
  RefreshCw, Plus, Trash2, File, FolderOpen,
  Settings, Search, Package, Globe, Lock,
  ChevronLeft, AlertCircle,
  PanelLeft, CheckCircle2,
  ExternalLink, FileText, Braces, Image, Database,
  Palette, CreditCard, LayoutTemplate, Monitor, Tablet, Smartphone,
  StopCircle, Zap, Eye, Code2, RotateCcw, GitBranch,
  Hash, Info, Maximize2, Minimize2, Layers,
  Menu, LayoutGrid, PanelRight, Maximize, Square
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type Phase =
  | 'idle'           // Initial prompt screen
  | 'questioning'    // AI is generating clarifying questions
  | 'questions'      // Questions shown to user
  | 'planning'       // AI generating plan
  | 'plan_review'    // Full-screen plan shown
  | 'building'       // Active build
  | 'done';          // Build complete, chat mode

type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error' | 'building';

type AgentStep = {
  id: string;
  label: string;
  detail?: string;
  status: 'pending' | 'active' | 'done';
};

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  status?: MessageStatus;
  timestamp: Date;
  agentSteps?: AgentStep[];
  codeLines?: number;
  buildTime?: number;
  fileCount?: number;
};

type QA = { question: string; answer: string };

type BuildPlan = {
  summary: string;
  steps: Array<{ title: string; description: string }>;
  techStack: string[];
  estimatedTime: string;
};

type LogEntry = {
  id: string;
  type: 'agent' | 'system' | 'error' | 'info';
  message: string;
  timestamp: Date;
};

type ConsoleEntry = {
  id: string;
  type: 'log' | 'error' | 'warn' | 'info';
  message: string;
  timestamp: Date;
};

type HistoryEntry = {
  id: string;
  files: ProjectFile[];
  label: string;
  timestamp: Date;
};

type ProjectFile = {
  id: string;
  name: string;
  language: string;
  content: string;
  isActive?: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://zenoai-uflq.onrender.com';
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
};

// ─── API Helper ───────────────────────────────────────────────────────────────

async function callAI(prompt: string, system?: string, maxTokens = 1500): Promise<string> {
  const body: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.content?.map((b: { type: string; text?: string }) =>
    b.type === 'text' ? b.text : '').join('') ?? '';
}

function safeParseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch { return null; }
}

// ─── Generate Clarifying Questions ────────────────────────────────────────────

async function generateQuestions(userText: string): Promise<string[]> {
  const raw = await callAI(
    `The user wants to build: "${userText}"

Generate 2-4 smart clarifying questions to better understand their requirements. Make them specific to what they want to build.

Return ONLY valid JSON array, no markdown:
["question1", "question2", "question3"]

Questions should help clarify: design style, features needed, target audience, technical preferences. Keep each question concise and actionable.`,
    undefined,
    300
  );
  const parsed = safeParseJSON<string[]>(raw);
  if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 4);
  return [
    'What style or design aesthetic are you going for?',
    'Who is the target audience for this?',
    'Are there any specific features you definitely want included?',
  ];
}

// ─── Generate Plan ────────────────────────────────────────────────────────────

async function generatePlan(userText: string, qas: QA[]): Promise<BuildPlan> {
  const context = qas.filter(q => q.answer.trim()).map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n');

  const raw = await callAI(
    `User wants to build: "${userText}"

Additional context from user:
${context || 'No additional context provided.'}

Create a detailed implementation plan. Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence overview of what will be built",
  "steps": [
    { "title": "Step title", "description": "What will be done in this step" },
    ...
  ],
  "techStack": ["HTML5", "CSS3", "JavaScript"],
  "estimatedTime": "~30 seconds"
}

Include 4-6 steps. Steps should cover: setup/structure, core UI, styling, interactivity, polish/final touches.`,
    undefined,
    500
  );
  const parsed = safeParseJSON<BuildPlan>(raw);
  if (parsed?.summary && Array.isArray(parsed.steps)) return parsed;
  return {
    summary: `Building ${userText} with modern, production-quality code.`,
    steps: [
      { title: 'Set up project structure', description: 'Create HTML, CSS, and JS files with proper architecture' },
      { title: 'Build core UI components', description: 'Implement the main interface elements' },
      { title: 'Add styling and animations', description: 'Apply visual design and micro-interactions' },
      { title: 'Implement functionality', description: 'Add interactivity and business logic' },
      { title: 'Polish and finalize', description: 'Review, optimize, and add finishing touches' },
    ],
    techStack: ['HTML5', 'CSS3', 'JavaScript'],
    estimatedTime: '~30 seconds',
  };
}

// ─── Build System Prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(userText: string, qas: QA[], plan: BuildPlan, existingFiles: ProjectFile[]): string {
  const context = qas.filter(q => q.answer.trim()).map(q => `- ${q.question}: ${q.answer}`).join('\n');
  const planContext = plan.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.description}`).join('\n');
  const fileContext = existingFiles.length > 0
    ? `\n\nEXISTING FILES:\n${existingFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}\n=== END FILE ===`).join('\n\n')}\n\nModify/extend these files.`
    : '';

  return `You are an elite AI software engineer. Build exactly what the user asks.

USER REQUEST: "${userText}"

USER PREFERENCES:
${context || 'No additional preferences.'}

AGREED PLAN:
${planContext}

TECH STACK: ${plan.techStack.join(', ')}
${fileContext}

OUTPUT FORMAT — use this EXACT format for EVERY file:

=== FILE: path/filename.ext ===
[complete file content here]
=== END FILE ===

CRITICAL RULES:
1. Output ALL files needed — HTML, CSS, JS, and everything else
2. Each file must be COMPLETE — never truncate or use "// ... rest of code"
3. For web projects: create SEPARATE files for HTML, CSS, and JS (not all inline)
4. Files must actually work — proper imports, correct paths, working logic
5. Use modern, production-quality code with beautiful styling
6. The CSS file must be linked from HTML, and JS must be referenced from HTML
7. Make it visually stunning with proper responsive design

Generate the complete project now:`;
}

// ─── Edit System Prompt ───────────────────────────────────────────────────────

function editSystemPrompt(userText: string, existingFiles: ProjectFile[]): string {
  return `You are an elite AI software engineer modifying an existing project.

USER EDIT REQUEST: "${userText}"

EXISTING PROJECT FILES:
${existingFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}\n=== END FILE ===`).join('\n\n')}

OUTPUT FORMAT — output ONLY the files you are modifying:

=== FILE: path/filename.ext ===
[complete updated file content here]
=== END FILE ===

CRITICAL RULES:
1. Output only the files that need to change, but output them COMPLETELY
2. Never truncate or use "// ... rest of code"
3. Maintain the existing file structure
4. Files must still work together correctly after changes`;
}

// ─── Chat System Prompt ───────────────────────────────────────────────────────

function chatSystemPrompt(userText: string, existingFiles: ProjectFile[]): string {
  const ctx = existingFiles.length > 0
    ? `Current project files: ${existingFiles.map(f => f.name).join(', ')}`
    : 'No project files yet.';
  return `You are Arc, an expert AI software engineer. ${ctx}\n\nAnswer clearly and concisely. User: "${userText}"`;
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
  if (!res.ok) throw new Error(`Session: ${res.status}`);
  const data = await res.json();
  return data.session_id ?? data.sessionId ?? data.id ?? `fallback-${Date.now()}`;
}

// ─── File Parsing ─────────────────────────────────────────────────────────────

function parseFilesFromOutput(text: string): ProjectFile[] {
  const fileMatches = [...text.matchAll(/=== FILE: (.+?) ===\n([\s\S]*?)(?:=== END FILE ===|(?==== FILE:)|$)/g)];
  if (fileMatches.length > 0) {
    return fileMatches.map(m => {
      const name = m[1].trim();
      const content = m[2].replace(/\n?=== END FILE ===$/, '').trim();
      const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
      return { id: `file-${name}`, name, language: ext, content };
    });
  }
  const codeBlocks = [...text.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
  if (codeBlocks.length > 0) {
    return codeBlocks.map((m, i) => {
      const lang = m[1]?.toLowerCase() ?? 'txt';
      const content = m[2].trim();
      const name = lang === 'html' ? 'index.html' : lang === 'css' ? 'style.css' : lang === 'javascript' || lang === 'js' ? 'script.js' : `file-${i + 1}.${lang}`;
      return { id: `file-${name}-${i}`, name, language: lang, content };
    });
  }
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    const start = text.search(/<(!DOCTYPE|html)/i);
    const content = start >= 0 ? text.slice(start) : text;
    return [{ id: 'file-index', name: 'index.html', language: 'html', content }];
  }
  return [];
}

function buildPreviewHtml(files: ProjectFile[]): string {
  const htmlFile = files.find(f => f.language === 'html') ?? files.find(f => f.content.includes('<html') || f.content.includes('<!DOCTYPE'));
  if (!htmlFile) return '';
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

// ─── Sub-Components ───────────────────────────────────────────────────────────

function TerminalLine({ text, delay = 0 }: { text: string; delay?: number }) {
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
      {displayed.length < text.length && <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse align-middle" />}
    </span>
  );
}

function parseThinkContent(raw: string): { thoughts: string[]; display: string } {
  const thoughts: string[] = [];
  const display = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    thoughts.push(inner.trim()); return '';
  }).trim();
  return { thoughts, display };
}

function ThoughtBlock({ thought }: { thought: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors font-medium">
        <Brain className="w-3 h-3" />
        <span>{open ? 'Hide' : 'Show'} reasoning</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-1.5 px-3 py-2.5 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-[11px] text-violet-700 dark:text-violet-300 font-mono whitespace-pre-wrap leading-relaxed">
              {thought}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Questions Panel ──────────────────────────────────────────────────────────

function QuestionsPanel({
  questions, onSubmit, onSkip,
}: {
  questions: string[];
  onSubmit: (answers: string[]) => void;
  onSkip: () => void;
}) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ''));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg mx-auto arc-glass rounded-2xl overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/[0.07] flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-xl bg-violet-500/15 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">A few quick questions</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Help me understand what you're building</p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {questions.map((q, i) => (
          <div key={i}>
            <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-2">
              <span className="text-violet-500 mr-1.5">{i + 1}.</span>{q}
            </p>
            <input
              value={answers[i]}
              onChange={e => setAnswers(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
              onKeyDown={e => { if (e.key === 'Enter' && i === questions.length - 1) onSubmit(answers); }}
              placeholder="Your answer…"
              className="w-full bg-white dark:bg-black/20 border border-gray-200 dark:border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/10 transition-all"
            />
          </div>
        ))}
      </div>

      <div className="px-5 py-4 border-t border-gray-200 dark:border-white/[0.07] flex items-center gap-3">
        <button
          onClick={() => onSubmit(answers)}
          className="flex-1 py-2.5 rounded-xl arc-btn-3d-primary text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          <Wand2 className="w-4 h-4" /> Generate Plan
        </button>
        <button
          onClick={onSkip}
          className="px-4 py-2.5 rounded-xl arc-btn-3d text-sm font-medium"
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
}

// ─── Full-screen Plan Review ──────────────────────────────────────────────────

function PlanReview({
  plan, onApprove, onSkip,
}: {
  plan: BuildPlan;
  onApprove: () => void;
  onSkip: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="w-full max-w-2xl bg-white dark:bg-[#0f0f11] rounded-3xl shadow-2xl overflow-hidden border border-gray-200 dark:border-white/[0.08]"
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Implementation Plan</h2>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">Review before building</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium border border-emerald-200 dark:border-emerald-500/20">
                {plan.estimatedTime}
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-3">{plan.summary}</p>
        </div>

        {/* Steps */}
        <div className="px-7 py-5 space-y-3 max-h-[40vh] overflow-y-auto arc-scrollbar">
          {plan.steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.07 }}
              className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.05] hover:border-violet-200 dark:hover:border-violet-500/20 transition-colors"
            >
              <div className="w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">{i + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{step.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 leading-relaxed">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tech Stack */}
        <div className="px-7 py-3 border-t border-gray-100 dark:border-white/[0.06] flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-gray-500 mr-1">Stack:</span>
          {plan.techStack.map(t => (
            <span key={t} className="text-[11px] px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/[0.05] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/[0.07] font-mono">
              {t}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="px-7 pb-7 pt-4 flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onApprove}
            className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-shadow"
          >
            <CheckCircle2 className="w-4.5 h-4.5" /> Approve & Build
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={onSkip}
            className="px-6 py-3.5 rounded-2xl arc-btn-3d text-sm font-semibold flex items-center gap-2"
          >
            <ArrowRight className="w-4 h-4" /> Skip to Build
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Agent Step (collapsible) ─────────────────────────────────────────────────

function AgentStepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  return (
    <div className={cn('flex items-start gap-3 py-2', !isLast && 'border-b border-gray-100 dark:border-white/[0.04]')}>
      <div className={cn(
        'w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all',
        step.status === 'done' ? 'bg-emerald-100 dark:bg-emerald-500/20' :
          step.status === 'active' ? 'bg-violet-100 dark:bg-violet-500/20' :
            'bg-gray-100 dark:bg-white/[0.04]'
      )}>
        {step.status === 'done' && <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />}
        {step.status === 'active' && <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }} className="w-2 h-2 rounded-full bg-violet-500" />}
        {step.status === 'pending' && <div className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-700" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-sm transition-colors',
          step.status === 'done' ? 'text-gray-400 dark:text-gray-600' :
            step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' :
              'text-gray-400 dark:text-gray-600'
        )}>{step.label}</span>
        {step.detail && step.status === 'active' && (
          <p className="text-[10px] font-mono text-violet-500 dark:text-violet-400 mt-0.5 truncate">{step.detail}</p>
        )}
      </div>
    </div>
  );
}

function CollapsibleAgentBlock({ steps, header }: { steps: AgentStep[]; header: string }) {
  const [open, setOpen] = useState(true);
  const allDone = steps.every(s => s.status === 'done');
  const activeStep = steps.find(s => s.status === 'active');

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm arc-glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-2.5 hover:bg-black/5 dark:hover:bg-white/[0.03] transition-colors"
      >
        {allDone
          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          : <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
              <Cpu className="w-4 h-4 text-violet-500 shrink-0" />
            </motion.div>
        }
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1 text-left truncate">
          {header}
        </span>
        <span className="text-[10px] font-mono text-gray-400 shrink-0">
          {steps.filter(s => s.status === 'done').length}/{steps.length}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 pb-3">
              {steps.map((step, i) => <AgentStepRow key={step.id} step={step} isLast={i === steps.length - 1} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  useEffect(() => { if (addingFile) inputRef.current?.focus(); }, [addingFile]);
  const commitAdd = () => {
    const name = newFileName.trim();
    if (name) onAddFile(name);
    setNewFileName(''); setAddingFile(false);
  };
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['html'].includes(ext)) return <Globe className="w-3 h-3 text-orange-500" />;
    if (['css', 'scss'].includes(ext)) return <Braces className="w-3 h-3 text-blue-500" />;
    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return <FileCode2 className="w-3 h-3 text-yellow-500" />;
    if (['json', 'yaml', 'yml'].includes(ext)) return <Database className="w-3 h-3 text-green-500" />;
    if (['md'].includes(ext)) return <FileText className="w-3 h-3 text-purple-500" />;
    if (['png', 'jpg', 'svg', 'gif'].includes(ext)) return <Image className="w-3 h-3 text-pink-500" />;
    return <File className="w-3 h-3 text-gray-500" />;
  };
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#080808]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-yellow-500" />
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Files</span>
        </div>
        <button onClick={() => setAddingFile(true)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map(f => (
          <div key={f.id} onClick={() => onSelectFile(f.id)}
            className={cn('group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all',
              activeFileId === f.id ? 'bg-black/5 dark:bg-white/[0.08] text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/[0.04]'
            )}>
            {getFileIcon(f.name)}
            <span className="text-[12px] flex-1 truncate font-mono">{f.name}</span>
            <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 transition-all">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {addingFile && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <File className="w-3 h-3 text-gray-400 shrink-0" />
            <input ref={inputRef} value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAddingFile(false); setNewFileName(''); } }}
              onBlur={commitAdd} placeholder="filename.ext"
              className="flex-1 bg-white dark:bg-white/[0.06] border border-violet-400/50 rounded px-2 py-0.5 text-[12px] font-mono text-gray-900 dark:text-white outline-none" />
          </div>
        )}
        {files.length === 0 && !addingFile && <div className="px-3 py-4 text-center text-[11px] text-gray-500 italic">No files yet</div>}
      </div>
    </div>
  );
}

// ─── Code Editor ──────────────────────────────────────────────────────────────

function CodeEditor({ file, onChange }: { file: ProjectFile; onChange: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const handleCopy = () => { navigator.clipboard.writeText(file.content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const handleScroll = () => { if (lineNumbersRef.current && textareaRef.current) lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop; };
  const lines = file.content.split('\n');
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#111]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-500">{file.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/[0.06] text-gray-500">{LANG_MAP[file.language] ?? file.language.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">{lines.length} lines</span>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-black/5 dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-400 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-500" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          <div ref={lineNumbersRef} className="w-10 bg-gray-100 dark:bg-[#080808] border-r border-gray-200 dark:border-white/[0.04] text-right py-4 px-2 shrink-0 overflow-hidden pointer-events-none select-none">
            {lines.map((_, i) => <div key={i} className="text-[11px] font-mono text-gray-400 dark:text-gray-700 leading-5">{i + 1}</div>)}
          </div>
          <textarea ref={textareaRef} value={file.content} onChange={e => onChange(e.target.value)} onScroll={handleScroll}
            spellCheck={false}
            className="flex-1 bg-transparent text-[12px] font-mono text-gray-800 dark:text-gray-300 leading-5 resize-none outline-none px-4 py-4 overflow-auto"
            style={{ tabSize: 2 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function AgentMessage({ msg }: { msg: Message }) {
  const { thoughts, display } = parseThinkContent(msg.content);
  if (msg.status === 'thinking') {
    return (
      <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl arc-glass w-fit">
        {[0, 1, 2].map(i => (
          <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-violet-500/60"
            animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
        ))}
      </div>
    );
  }
  if (msg.agentSteps) {
    const allDone = msg.agentSteps.every(s => s.status === 'done');
    const header = allDone
      ? `Built ${msg.fileCount ?? 0} file${(msg.fileCount ?? 0) !== 1 ? 's' : ''} · ${msg.codeLines ?? 0} lines · ${msg.buildTime ?? 0}s`
      : msg.agentSteps.find(s => s.status === 'active')?.label ?? 'Building…';
    return <CollapsibleAgentBlock steps={msg.agentSteps} header={header} />;
  }
  if (msg.status === 'streaming') {
    return (
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="max-w-[80%] flex flex-col gap-1.5">
        {thoughts.map((t, i) => <ThoughtBlock key={i} thought={t} />)}
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
          {display || <span className="inline-block w-1.5 h-3.5 bg-violet-500/60 animate-pulse align-middle rounded-sm" />}
          {display && <span className="inline-block w-1.5 h-3.5 bg-violet-500/60 ml-0.5 animate-pulse align-middle rounded-sm" />}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="max-w-[80%] flex flex-col gap-1.5">
      {thoughts.map((t, i) => <ThoughtBlock key={i} thought={t} />)}
      {display && (
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
          {display}
        </div>
      )}
      {msg.status === 'error' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-700 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {msg.content}
        </div>
      )}
    </motion.div>
  );
}

// ─── Main Builder Component ────────────────────────────────────────────────────

export default function Builder() {
  const { theme } = useTheme();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return false;
  });
  useEffect(() => { setIsDark(theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)); }, [theme]);

  // ── Core State ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [originalPrompt, setOriginalPrompt] = useState('');
  const [currentQAs, setCurrentQAs] = useState<QA[]>([]);
  const [currentPlan, setCurrentPlan] = useState<BuildPlan | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState('Builder');

  // ── Project State ─────────────────────────────────────────────────────────
  const [previewCode, setPreviewCode] = useState('');
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showFileTree, setShowFileTree] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'console' | 'logs'>('preview');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  // ── Build State ───────────────────────────────────────────────────────────
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [buildTime, setBuildTime] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 'init', type: 'system', message: 'Arc dev server ready.', timestamp: new Date() }]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ── UI State ──────────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const buildStartRef = useRef<number>(0);
  const projectFilesRef = useRef<ProjectFile[]>([]);

  useEffect(() => { projectFilesRef.current = projectFiles; }, [projectFiles]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check(); window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  useEffect(() => {
    if (projectFiles.length > 0 && !activeFileId) setActiveFileId(projectFiles[0].id);
  }, [projectFiles, activeFileId]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ARC_CONSOLE') {
        setConsoleLogs(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, type: event.data.level, message: event.data.args.join(' '), timestamp: new Date() }]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, type, message, timestamp: new Date() }]);
  }, []);

  const activeFile = projectFiles.find(f => f.id === activeFileId) ?? null;

  const pushHistory = useCallback((files: ProjectFile[], label: string) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, { id: Date.now().toString(), files: JSON.parse(JSON.stringify(files)), label, timestamp: new Date() }];
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [historyIndex]);

  const addFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
    const f: ProjectFile = { id: `file-${name}-${Date.now()}`, name, language: ext, content: '' };
    setProjectFiles(prev => [...prev, f]);
    setActiveFileId(f.id); setActiveTab('code');
  };

  const deleteFile = (id: string) => {
    setProjectFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (activeFileId === id) setActiveFileId(next[0]?.id ?? null);
      return next;
    });
  };

  const updateFileContent = (id: string, content: string) => {
    setProjectFiles(prev => prev.map(f => f.id === id ? { ...f, content } : f));
  };

  const handleDownload = async () => {
    if (projectFiles.length === 0 && !previewCode) return;
    if (projectFiles.length === 1) {
      const file = projectFiles[0];
      const blob = new Blob([file.content], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    } else if (projectFiles.length > 1) {
      try {
        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm' as string) as unknown as { default: unknown }).default as { file: (name: string, content: string) => void; generateAsync: (opts: { type: string }) => Promise<Blob> };
        const zip = JSZip as unknown as { file: (name: string, content: string) => void; generateAsync: (opts: { type: string }) => Promise<Blob> };
        projectFiles.forEach(f => zip.file(f.name, f.content));
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'arc-project.zip'; a.click();
      } catch {
        for (let i = 0; i < projectFiles.length; i++) {
          await new Promise(r => setTimeout(r, i * 300));
          const blob = new Blob([projectFiles[i].content], { type: 'text/plain' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = projectFiles[i].name; a.click();
        }
      }
    }
    addLog('system', 'Project downloaded.');
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    addLog('system', 'Stream cancelled.');
    setMessages(prev => prev.map(m => m.status === 'building' || m.status === 'streaming' ? { ...m, status: 'done', content: m.content || 'Stopped.' } : m));
  };

  const handleNewProject = () => {
    abortRef.current?.abort();
    setPhase('idle');
    setMessages([]); setPreviewCode(''); setProjectFiles([]); setActiveFileId(null);
    setCurrentPlan(null); setCurrentQAs([]); setOriginalPrompt(''); setQuestions([]);
    setLogs([{ id: Date.now().toString(), type: 'system', message: 'New project started.', timestamp: new Date() }]);
    setConsoleLogs([]); setSessionId(null); setIsStreaming(false);
    setHistory([]); setHistoryIndex(-1); setTokenCount(0); setBuildTime(null);
    if (isMobile) setMobileView('chat');
  };

  // ── Phase 1: Handle initial user prompt → generate questions ──────────────
  const handleInitialPrompt = async (text: string) => {
    setOriginalPrompt(text);
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }]);
    setPhase('questioning');
    setInput('');

    // Show "generating questions" status message
    const qMsgId = `qmsg-${Date.now()}`;
    setMessages(prev => [...prev, { id: qMsgId, role: 'agent', content: '', status: 'thinking', timestamp: new Date() }]);

    try {
      const qs = await generateQuestions(text);
      setQuestions(qs);
      setMessages(prev => prev.map(m => m.id === qMsgId ? { ...m, status: 'done', content: 'Let me ask a few quick questions to better understand what you need.' } : m));
      setPhase('questions');
    } catch {
      setMessages(prev => prev.filter(m => m.id !== qMsgId));
      await proceedToPlan(text, []);
    }
  };

  // ── Phase 2: User answered questions → generate plan ──────────────────────
  const handleQuestionsSubmit = async (answers: string[]) => {
    const qas: QA[] = questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' }));
    setCurrentQAs(qas);

    // Add Q&A summary to chat
    const answeredQs = qas.filter(q => q.answer.trim());
    if (answeredQs.length > 0) {
      const summary = answeredQs.map(q => `**${q.question}**\n${q.answer}`).join('\n\n');
      setMessages(prev => [...prev, { id: `qa-${Date.now()}`, role: 'user', content: summary, timestamp: new Date() }]);
    }

    await proceedToPlan(originalPrompt, qas);
  };

  const handleQuestionsSkip = async () => {
    await proceedToPlan(originalPrompt, []);
  };

  // ── Phase 3: Generate plan ─────────────────────────────────────────────────
  const proceedToPlan = async (prompt: string, qas: QA[]) => {
    setPhase('planning');
    const planMsgId = `planmsg-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: planMsgId, role: 'agent', content: "Let me put together a proper plan for this…",
      status: 'done', timestamp: new Date(),
    }]);

    // Show thinking
    const thinkId = `think-${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkId, role: 'agent', content: '', status: 'thinking', timestamp: new Date() }]);

    try {
      const plan = await generatePlan(prompt, qas);
      setCurrentPlan(plan);
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      setPhase('plan_review');
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      // If plan generation fails, build directly
      await runBuild(prompt, qas, null, 'build');
    }
  };

  // ── Phase 4: Plan approved → run build ────────────────────────────────────
  const handlePlanApprove = async () => {
    setPhase('building');
    if (currentPlan) {
      setMessages(prev => [...prev, {
        id: `planchat-${Date.now()}`, role: 'agent',
        content: `Plan approved! Building now…`,
        status: 'done', timestamp: new Date(),
      }]);
    }
    await runBuild(originalPrompt, currentQAs, currentPlan, 'build');
  };

  const handlePlanSkip = async () => {
    setPhase('building');
    await runBuild(originalPrompt, currentQAs, null, 'build');
  };

  // ── Core Build Function ────────────────────────────────────────────────────
  const runBuild = async (userText: string, qas: QA[], plan: BuildPlan | null, intent: 'build' | 'edit') => {
    setIsStreaming(true);
    buildStartRef.current = Date.now();
    setActiveTab('logs');
    setPhase('building');

    const buildMsgId = `build-${Date.now()}`;
    const planSteps = plan?.steps ?? [
      { title: 'Analyze requirements', description: '' },
      { title: 'Plan architecture', description: '' },
      { title: 'Generate code', description: '' },
      { title: 'Assemble files', description: '' },
    ];

    const initialSteps: AgentStep[] = planSteps.map((s, i) => ({
      id: `step-${i}`, label: s.title,
      status: i === 0 ? 'active' : 'pending',
    }));

    setMessages(prev => [...prev, {
      id: buildMsgId, role: 'agent', content: '', status: 'building',
      timestamp: new Date(), agentSteps: initialSteps,
    }]);

    const advanceStep = (idx: number) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map((s, i) => {
          if (s.status === 'active') return { ...s, status: 'done' as const };
          if (i === idx) return { ...s, status: 'active' as const };
          return s;
        }) ?? [];
        return { ...m, agentSteps: steps };
      }));
    };

    const updateStepDetail = (idx: number, detail: string) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map((s, i) => i === idx ? { ...s, detail } : s) ?? [];
        return { ...m, agentSteps: steps };
      }));
    };

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      let sid = sessionId;
      if (!sid) {
        try { sid = await createSession(); setSessionId(sid); } catch { sid = `fallback-${Date.now()}`; }
      }

      advanceStep(1); addLog('agent', `Planning: "${userText}"`);

      const currentFiles = projectFilesRef.current;
      const prompt = intent === 'edit'
        ? editSystemPrompt(userText, currentFiles)
        : buildSystemPrompt(userText, qas, plan ?? {
            summary: userText, steps: planSteps,
            techStack: ['HTML5', 'CSS3', 'JavaScript'], estimatedTime: '~30s',
          }, []);

      advanceStep(2); addLog('agent', 'Generating code files…');

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: prompt }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let carryover = '';
      let fullText = '';
      let totalChars = 0;
      let lastParsedFileCount = 0;

      while (true) {
        const { done, value } = await reader.read();
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
          const partial = parseFilesFromOutput(fullText);
          if (partial.length > lastParsedFileCount) {
            lastParsedFileCount = partial.length;
            const latest = partial[partial.length - 1];
            updateStepDetail(2, latest.name);
            addLog('agent', `Writing ${latest.name}…`);
          }
        }
      }

      advanceStep(3);
      let finalFiles = parseFilesFromOutput(fullText);
      if (finalFiles.length === 0) throw new Error('No files in response. Try rephrasing.');

      if (intent === 'edit' && currentFiles.length > 0) {
        const merged = [...currentFiles];
        finalFiles.forEach(nf => {
          const idx = merged.findIndex(f => f.name === nf.name);
          if (idx !== -1) merged[idx] = nf; else merged.push(nf);
        });
        finalFiles = merged;
      }

      setProjectFiles(finalFiles);
      if (finalFiles.length > 0) setActiveFileId(finalFiles[0].id);

      const preview = buildPreviewHtml(finalFiles);
      if (preview) { setPreviewCode(preview); }
      else if (fullText.includes('<html') || fullText.includes('<!DOCTYPE')) {
        const start = fullText.search(/<(!DOCTYPE|html)/i);
        setPreviewCode(CONSOLE_INTERCEPTOR + (start >= 0 ? fullText.slice(start) : fullText));
      }

      const elapsed = Math.round((Date.now() - buildStartRef.current) / 1000);
      setBuildTime(elapsed);
      pushHistory(finalFiles, userText.slice(0, 40));
      const lineCount = finalFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0);

      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map(s => ({ ...s, status: 'done' as const })) ?? [];
        return { ...m, status: 'done', agentSteps: steps, content: `Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} · ${lineCount} lines · ${elapsed}s`, codeLines: lineCount, buildTime: elapsed, fileCount: finalFiles.length };
      }));

      // Post-build chat message from AI
      const doneId = `done-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: doneId, role: 'agent',
        content: `Done! Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} (${lineCount} lines) in ${elapsed}s. You can preview it on the right, or ask me to make any changes.`,
        status: 'done', timestamp: new Date(),
      }]);

      addLog('system', `Done: ${finalFiles.length} files, ${lineCount} lines in ${elapsed}s.`);
      setActiveTab('preview');
      setShowFileTree(true);
      setPhase('done');
      if (isMobile) setMobileView('preview');

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', errMsg);
      setMessages(prev => prev.map(m =>
        m.id === buildMsgId
          ? { ...m, status: 'error', content: `Build failed: ${errMsg}`, agentSteps: m.agentSteps?.map(s => s.status === 'active' ? { ...s, status: 'pending' as const } : s) }
          : m
      ));
      setPhase('done');
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Chat / Edit in "done" phase ────────────────────────────────────────────
  const runChat = async (userText: string) => {
    const chatMsgId = `chat-${Date.now()}`;
    setMessages(prev => [...prev, { id: chatMsgId, role: 'agent', content: '', status: 'streaming', timestamp: new Date() }]);
    setIsStreaming(true);
    try {
      const sid = sessionId || `fallback-${Date.now()}`;
      const prompt = chatSystemPrompt(userText, projectFilesRef.current);
      const abort = new AbortController(); abortRef.current = abort;
      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: prompt }), signal: abort.signal,
      });
      if (!res.ok) throw new Error('Failed to stream response');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let carryover = '', fullText = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const raw = carryover + decoder.decode(value, { stream: true });
          const lines = raw.split('\n');
          carryover = lines.pop() ?? '';
          for (const line of lines) {
            const chunk = extractChunkText(line);
            if (chunk) { fullText += chunk; setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, content: fullText } : m)); }
          }
        }
      }
      setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, status: 'done' } : m));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, content: 'Failed to respond. Try again.', status: 'error' } : m));
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Detect edit intent and run accordingly ────────────────────────────────
  const handlePostBuildSubmit = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }]);

    // Detect if it's an edit or chat
    const editKeywords = ['add', 'remove', 'change', 'update', 'fix', 'make', 'modify', 'edit', 'replace', 'delete', 'insert', 'move', 'style', 'color', 'font', 'button', 'header', 'footer', 'nav', 'sidebar', 'feature', 'dark', 'light', 'responsive'];
    const lc = text.toLowerCase();
    const looksLikeEdit = projectFiles.length > 0 && editKeywords.some(kw => lc.includes(kw));

    if (looksLikeEdit) {
      await runBuild(text, [], null, 'edit');
    } else {
      await runChat(text);
    }
  };

  // ── Master Submit ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    if (phase === 'idle' || phase === 'done') {
      if (phase === 'idle') {
        await handleInitialPrompt(text);
      } else {
        setInput('');
        await handlePostBuildSubmit();
      }
    }
  };

  // Fix: handleSubmit for the done phase needs to read input before clearing
  const handleSubmitWrapper = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    if (phase === 'idle') {
      await handleInitialPrompt(text);
    } else if (phase === 'done') {
      setInput('');
      setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }]);
      const editKeywords = ['add', 'remove', 'change', 'update', 'fix', 'make', 'modify', 'edit', 'replace', 'style', 'color', 'button', 'feature', 'dark', 'light', 'responsive', 'nav', 'header', 'footer'];
      const looksLikeEdit = projectFiles.length > 0 && editKeywords.some(kw => text.toLowerCase().includes(kw));
      if (looksLikeEdit) {
        await runBuild(text, [], null, 'edit');
      } else {
        await runChat(text);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitWrapper(); }
  };

  // ── Layout flags ──────────────────────────────────────────────────────────
  const hasProject = projectFiles.length > 0 || previewCode.length > 0;
  const showSplit = hasProject && !isMobile;
  const showChatPanel = !isMobile || mobileView === 'chat';
  const showPreviewPanel = !isMobile ? hasProject : mobileView === 'preview';

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        :root {
          --arc-glass-bg: rgba(255,255,255,0.8);
          --arc-glass-border: rgba(0,0,0,0.08);
          --arc-btn-bg: linear-gradient(180deg,#ffffff 0%,#f3f4f6 100%);
          --arc-btn-border: rgba(0,0,0,0.1);
          --arc-btn-shadow: 0 1px 2px rgba(0,0,0,0.05);
          --arc-btn-color: #374151;
        }
        .dark {
          --arc-glass-bg: rgba(255,255,255,0.03);
          --arc-glass-border: rgba(255,255,255,0.08);
          --arc-btn-bg: linear-gradient(180deg,rgba(255,255,255,0.07) 0%,rgba(255,255,255,0.03) 100%);
          --arc-btn-border: transparent;
          --arc-btn-shadow: 0 2px 8px rgba(0,0,0,0.3);
          --arc-btn-color: #9CA3AF;
        }
        .arc-glass { background:var(--arc-glass-bg); border:1px solid var(--arc-glass-border); }
        .arc-btn-3d { background:var(--arc-btn-bg); box-shadow:var(--arc-btn-shadow); border:1px solid var(--arc-btn-border); color:var(--arc-btn-color); transition:all 0.15s ease; }
        .arc-btn-3d:hover { transform:translateY(-1px); filter:brightness(1.05); }
        .arc-btn-3d:active { transform:translateY(0); }
        .arc-btn-3d-primary { background:linear-gradient(180deg,rgba(139,92,246,0.9) 0%,rgba(109,40,217,0.85) 100%); box-shadow:0 2px 10px rgba(139,92,246,0.3); transition:all 0.15s ease; border:none; }
        .arc-btn-3d-primary:hover { box-shadow:0 4px 15px rgba(139,92,246,0.4); transform:translateY(-1px); }
        .arc-btn-3d-primary:disabled { opacity:0.35; transform:none; }
        .arc-scrollbar::-webkit-scrollbar { width:4px; }
        .arc-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .arc-scrollbar::-webkit-scrollbar-thumb { background:rgba(156,163,175,0.3); border-radius:4px; }
        .dark .arc-scrollbar::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); }
      `}</style>

      {/* Full-screen Plan Review Overlay */}
      <AnimatePresence>
        {phase === 'plan_review' && currentPlan && (
          <PlanReview plan={currentPlan} onApprove={handlePlanApprove} onSkip={handlePlanSkip} />
        )}
      </AnimatePresence>

      <div className={cn("flex h-screen overflow-hidden transition-colors duration-300", isDark ? 'dark bg-[#060608] text-white' : 'bg-gray-50 text-gray-900')}>
        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentPage={currentPage} onNavigate={setCurrentPage} />

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Topbar */}
          <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/[0.06] bg-white/60 dark:bg-black/30 backdrop-blur-xl z-20">
            <div className="flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors md:hidden">
                <Menu className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-semibold text-gray-800 dark:text-white">Arc Builder</span>
              </div>
              {hasProject && (
                <div className="hidden md:flex items-center gap-1 ml-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium">
                    {projectFiles.length} file{projectFiles.length !== 1 ? 's' : ''}
                  </span>
                  {buildTime && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 font-medium">{buildTime}s</span>}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isStreaming && (
                <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 hover:bg-red-100 transition-colors">
                  <StopCircle className="w-3.5 h-3.5" /> Stop
                </button>
              )}
              {hasProject && (
                <>
                  <button onClick={handleDownload} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors" title="Download">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(window.location.href); setShowShareToast(true); setTimeout(() => setShowShareToast(false), 2500); }}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors" title="Share">
                    <Share className="w-4 h-4" />
                  </button>
                </>
              )}
              <button onClick={handleNewProject} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl arc-btn-3d text-xs font-medium">
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </div>

          {/* Share toast */}
          <AnimatePresence>
            {showShareToast && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-xs font-medium rounded-xl shadow-lg">
                Link copied!
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Area */}
          <div className="flex flex-1 overflow-hidden">
            {/* Chat Panel */}
            {(showChatPanel) && (
              <div className={cn("flex flex-col border-r border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#080808]",
                showSplit ? 'w-[420px] shrink-0' : 'flex-1'
              )}>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto arc-scrollbar">
                  <div className="p-4 space-y-4 min-h-full flex flex-col">
                    {/* Empty state */}
                    {messages.length === 0 && phase === 'idle' && (
                      <div className="flex-1 flex flex-col items-center justify-center py-12 px-4">
                        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                          className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center mb-5 shadow-xl shadow-violet-500/25">
                          <Sparkles className="w-7 h-7 text-white" />
                        </motion.div>
                        <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                          className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                          What are we building?
                        </motion.h2>
                        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
                          className="text-sm text-gray-500 text-center mb-8 max-w-xs">
                          Describe your idea and I'll ask a few questions, then show you a plan before building.
                        </motion.p>
                        <div className="w-full max-w-sm space-y-2">
                          {SUGGESTIONS.map((s, i) => (
                            <motion.button key={i}
                              initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05 }}
                              onClick={() => { setInput(s.text); textareaRef.current?.focus(); }}
                              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl arc-glass hover:border-violet-300 dark:hover:border-violet-500/40 text-left transition-all group">
                              <s.icon className={cn('w-4 h-4 shrink-0', s.color)} />
                              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">{s.text}</span>
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Messages */}
                    {messages.map(msg => (
                      <motion.div key={msg.id}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                      >
                        {msg.role === 'user' ? (
                          <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-violet-600 text-white text-sm leading-relaxed whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        ) : (
                          <AgentMessage msg={msg} />
                        )}
                      </motion.div>
                    ))}

                    {/* Questions Panel inline */}
                    {phase === 'questions' && questions.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                        <QuestionsPanel questions={questions} onSubmit={handleQuestionsSubmit} onSkip={handleQuestionsSkip} />
                      </motion.div>
                    )}

                    {/* Planning indicator */}
                    {phase === 'planning' && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-2 px-4 py-3 arc-glass rounded-2xl text-sm text-gray-600 dark:text-gray-400">
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                            <Wand2 className="w-4 h-4 text-violet-500" />
                          </motion.div>
                          <span>Generating implementation plan…</span>
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Input */}
                <div className="shrink-0 p-3 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#080808]">
                  <div className="arc-input-glass rounded-2xl flex flex-col">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={isStreaming || (phase !== 'idle' && phase !== 'done')}
                      placeholder={
                        phase === 'idle' ? "Describe what you want to build…" :
                        phase === 'questions' ? "Answer above or skip…" :
                        phase === 'planning' ? "Generating plan…" :
                        phase === 'plan_review' ? "Review the plan above…" :
                        phase === 'building' ? "Building your project…" :
                        "Ask questions or request changes…"
                      }
                      rows={1}
                      className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 resize-none outline-none min-h-[44px] max-h-[160px]"
                      style={{ height: 'auto' }}
                    />
                    <div className="flex items-center justify-between px-3 pb-3">
                      <div className="flex items-center gap-1.5">
                        {isStreaming && (
                          <span className="text-[11px] text-violet-500 font-medium flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {tokenCount > 0 ? `~${tokenCount.toLocaleString()} tokens` : 'Connecting…'}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={handleSubmitWrapper}
                        disabled={!input.trim() || isStreaming || (phase !== 'idle' && phase !== 'done')}
                        className="w-8 h-8 rounded-xl arc-btn-3d-primary flex items-center justify-center disabled:opacity-30"
                      >
                        {isStreaming ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-center text-[10px] text-gray-400 mt-2">Arc can make mistakes · Always review generated code</p>
                </div>
              </div>
            )}

            {/* Preview Panel */}
            {showPreviewPanel && hasProject && (
              <div className="flex-1 flex flex-col overflow-hidden bg-gray-100 dark:bg-[#050507]">
                {/* Preview toolbar */}
                <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#080808]">
                  {/* Tabs */}
                  <div className="flex items-center gap-1">
                    {(['preview', 'code', 'console', 'logs'] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={cn('px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors capitalize',
                          activeTab === tab ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="flex-1" />

                  {activeTab === 'preview' && (
                    <div className="flex items-center gap-1 mr-2">
                      {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
                        <button key={d} onClick={() => setPreviewDevice(d)}
                          className={cn('p-1.5 rounded-lg transition-colors', previewDevice === d ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-gray-300' : 'text-gray-400 hover:text-gray-600')}>
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  )}

                  {activeTab === 'code' && (
                    <button onClick={() => setShowFileTree(v => !v)}
                      className={cn('p-1.5 rounded-lg transition-colors mr-1', showFileTree ? 'bg-gray-100 dark:bg-white/[0.08] text-violet-600 dark:text-violet-400' : 'text-gray-400 hover:text-gray-600')}>
                      <PanelLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* File tree + code */}
                {activeTab === 'code' && (
                  <div className="flex-1 flex overflow-hidden">
                    {showFileTree && (
                      <div className="w-44 shrink-0 border-r border-gray-200 dark:border-white/[0.06]">
                        <FileTree files={projectFiles} activeFileId={activeFileId} onSelectFile={setActiveFileId} onDeleteFile={deleteFile} onAddFile={addFile} />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      {activeFile
                        ? <CodeEditor file={activeFile} onChange={(c) => updateFileContent(activeFile.id, c)} />
                        : <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400"><FileCode2 className="w-8 h-8 opacity-30" /><span className="text-sm">Select a file</span></div>
                      }
                    </div>
                  </div>
                )}

                {/* Preview */}
                {activeTab === 'preview' && (
                  <div className="flex-1 flex flex-col items-center p-4 overflow-hidden">
                    <div className="bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-white/[0.08] shadow-2xl flex flex-col relative h-full"
                      style={{ width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px', maxWidth: '100%' }}>
                      {/* Browser chrome */}
                      <div className="h-9 shrink-0 bg-gray-100 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
                        </div>
                        <div className="mx-auto flex-1 max-w-xs h-5 bg-white dark:bg-white/[0.06] rounded-md flex items-center justify-center text-[10px] text-gray-500 font-mono">localhost:3000</div>
                        {previewCode && (
                          <button onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(previewCode); w.document.close(); } }}
                            className="p-1 rounded hover:bg-black/5 text-gray-500 transition-colors"><ExternalLink className="w-3 h-3" /></button>
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
                              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-4">Building your project…</p>
                              <p className="text-xs text-gray-500 mt-1 font-mono">{tokenCount > 0 ? `~${tokenCount.toLocaleString()} tokens` : 'Connecting…'}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {previewCode
                          ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                          : !isStreaming && <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400"><Play className="w-8 h-8 opacity-20" /><span className="text-sm opacity-60">Preview will appear here</span></div>
                        }
                      </div>
                    </div>
                  </div>
                )}

                {/* Console */}
                {activeTab === 'console' && (
                  <div className="flex-1 bg-white dark:bg-[#080808] font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                    {consoleLogs.length === 0
                      ? <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400"><Terminal className="w-6 h-6 opacity-30" /><span className="text-xs">No console output yet</span></div>
                      : consoleLogs.map(log => (
                        <div key={log.id} className={cn('flex gap-2 mb-1.5', log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-amber-500' : 'text-gray-700 dark:text-gray-400')}>
                          <span className="text-gray-400 shrink-0">{log.timestamp.toLocaleTimeString()}</span>
                          <span className="whitespace-pre-wrap break-words">{log.message}</span>
                        </div>
                      ))
                    }
                    <div ref={consoleEndRef} />
                  </div>
                )}

                {/* Logs */}
                {activeTab === 'logs' && (
                  <div className="flex-1 bg-white dark:bg-[#080808] font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                    <div className="mb-3 flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-violet-500" />
                      <span className="text-violet-600 dark:text-violet-400 font-semibold">Arc Terminal</span>
                    </div>
                    {logs.map((log, i) => (
                      <div key={log.id} className={cn('flex gap-2 mb-1.5 leading-relaxed',
                        log.type === 'system' ? 'text-emerald-600 dark:text-emerald-400' :
                          log.type === 'error' ? 'text-red-600 dark:text-red-400' :
                            log.type === 'info' ? 'text-blue-600 dark:text-blue-400' :
                              'text-gray-600 dark:text-gray-400'
                      )}>
                        <span className="shrink-0 text-gray-400 dark:text-gray-600">{log.timestamp.toLocaleTimeString()}</span>
                        <span className="shrink-0 text-gray-500 dark:text-gray-700">[{log.type.slice(0, 3)}]</span>
                        {log.type === 'agent' && i >= logs.length - 3
                          ? <TerminalLine text={log.message} delay={0} />
                          : <span className="whitespace-pre-wrap break-words">{log.message}</span>
                        }
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
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
              <MessageSquare className="w-4 h-4" /> Chat
            </button>
            <button onClick={() => setMobileView('preview')} disabled={!hasProject}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'preview' ? 'text-violet-600 dark:text-white' : !hasProject ? 'text-gray-300 dark:text-gray-700' : 'text-gray-500')}>
              <Eye className="w-4 h-4" /> Preview
            </button>
          </div>
        )}
      </div>
    </>
  );
}
