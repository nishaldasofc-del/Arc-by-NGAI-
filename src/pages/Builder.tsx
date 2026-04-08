--- START OF FILE Builder.tsx ---
import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
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
  Palette, CreditCard, LayoutTemplate, Monitor, Tablet, Smartphone
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageStatus =
  | 'thinking' | 'questioning' | 'planning' | 'awaiting_approval'
  | 'building' | 'streaming' | 'generating_code' | 'done' | 'error';

type ClarifyOption = { id: string; label: string; description?: string };
type ClarifyQuestion = {
  id: string; question: string; type: 'single' | 'multi';
  options: ClarifyOption[]; selectedIds: string[];
};
type PlanStep = { id: string; title: string; description: string };
type AgentStep = {
  id: string; label: string; detail?: string;
  status: 'pending' | 'active' | 'done'; expanded?: boolean;
};
type Message = {
  id: string; role: 'user' | 'agent'; content: string;
  status?: MessageStatus; codeLines?: number; timestamp: Date;
  questions?: ClarifyQuestion[]; questionsDone?: boolean;
  plan?: PlanStep[]; planApproved?: boolean; planLabel?: string;
  agentSteps?: AgentStep[]; intent?: 'build' | 'modify' | 'chat';
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

const BASE_URL = 'https://zenoai-uflq.onrender.com';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const SUGGESTIONS = [
  { icon: <Package className="w-5 h-5 text-indigo-500" />, text: 'Build a modern SaaS pricing page' },
  { icon: <Palette className="w-5 h-5 text-pink-500" />, text: 'Create a personal portfolio with animations' },
  { icon: <Activity className="w-5 h-5 text-emerald-500" />, text: 'Design a dashboard with live charts' },
  { icon: <Rocket className="w-5 h-5 text-amber-500" />, text: 'Build an app landing page with waitlist' },
  { icon: <LayoutTemplate className="w-5 h-5 text-blue-500" />, text: 'Create a multi-page website with nav' },
  { icon: <CreditCard className="w-5 h-5 text-violet-500" />, text: 'Build an e-commerce product page' },
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
  py: 'Python', txt: 'Text',
};

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function callAI(prompt: string, maxTokens = 1200): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.map((b: { type: string; text?: string }) =>
    b.type === 'text' ? b.text : '').join('') ?? '';
}

async function detectIntent(userText: string): Promise<'chat' | 'build' | 'modify'> {
  const prompt = `Classify the following user request into exactly ONE of these categories:
- "build" (user wants to create a new app, website, or UI project from scratch)
- "modify" (user wants to change, add to, fix, or update existing code)
- "chat" (user is asking a question, asking for explanation, or having a general chat)

User request: "${userText}"

Return ONLY a raw JSON object, no markdown formatting:
{"intent": "build" | "modify" | "chat"}`;
  try {
    const raw = await callAI(prompt, 50);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (['chat', 'build', 'modify'].includes(parsed.intent)) return parsed.intent;
    return 'chat';
  } catch {
    return 'build';
  }
}

async function generateAIQuestions(userText: string): Promise<ClarifyQuestion[]> {
  const prompt = `You are Arc, an elite AI frontend developer agent.
User wants to build: "${userText}"

Generate 2 sharp clarifying questions. Return ONLY a valid JSON array, NO markdown, NO backticks:
[{"id":"q1","question":"...","type":"single","options":[{"id":"q1_a","label":"...","description":"..."}]}]
Rules: type is single/multi, 2-4 options each, concrete not vague.`;
  try {
    const raw = await callAI(prompt, 300);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned).map((q: ClarifyQuestion) => ({ ...q, selectedIds: [] }));
  } catch {
    return [{
      id: 'q1', question: `How would you like to style this project?`, type: 'single',
      options: [
        { id: 'q1_a', label: 'Modern & clean', description: 'White space, sharp typography' },
        { id: 'q1_b', label: 'Dark premium', description: 'Glassmorphism, dark background' },
      ], selectedIds: [],
    }];
  }
}

async function generateAIPlan(userText: string, answers: Record<string, string[]>): Promise<{ label: string; steps: PlanStep[]; files: string[] }> {
  const answerSummary = Object.entries(answers).map(([q, opts]) => `- ${q}: ${opts.join(', ')}`).join('\n');
  const prompt = `You are Arc, elite AI frontend developer.
User wants: "${userText}"
Answers: ${answerSummary}

Return ONLY valid JSON (no markdown):
{"label":"Short title","files":["index.html","style.css","app.js"],"steps":[{"id":"p1","title":"...","description":"..."}]}
Rules: 4 steps, specific file names, ordered by implementation.`;
  try {
    const raw = await callAI(prompt, 300);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      label: `Building: ${userText.slice(0, 30)}...`,
      files: ['index.html', 'style.css', 'app.js'],
      steps: [
        { id: 'p1', title: 'Initialize files', description: 'Setup file structure' },
        { id: 'p2', title: 'Design system', description: 'Typography and variables' },
        { id: 'p3', title: 'Core Layout', description: 'Build main components' },
        { id: 'p4', title: 'Interactivity', description: 'Add JavaScript logic' },
      ],
    };
  }
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

// ─── Terminal Typing Effect ────────────────────────────────────────────────────

function TerminalLine({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const iv = setInterval(() => {
      if (i <= text.length) {
        setDisplayed(text.slice(0, i));
        i++;
      } else {
        clearInterval(iv);
      }
    }, 12);
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
}

// ─── File Tree Component ───────────────────────────────────────────────────────

function FileTree({
  files, activeFileId, onSelectFile, onDeleteFile, onAddFile
}: {
  files: ProjectFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onAddFile: () => void;
}) {
  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop() ?? '';
    if (['html'].includes(ext)) return <Globe className="w-3 h-3 text-orange-500 dark:text-orange-400" />;
    if (['css'].includes(ext)) return <Braces className="w-3 h-3 text-blue-500 dark:text-blue-400" />;
    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return <FileCode2 className="w-3 h-3 text-yellow-500 dark:text-yellow-400" />;
    if (['json'].includes(ext)) return <Database className="w-3 h-3 text-green-500 dark:text-green-400" />;
    if (['md'].includes(ext)) return <FileText className="w-3 h-3 text-purple-500 dark:text-purple-400" />;
    if (['png', 'jpg', 'svg'].includes(ext)) return <Image className="w-3 h-3 text-pink-500 dark:text-pink-400" />;
    return <File className="w-3 h-3 text-gray-500 dark:text-gray-400" />;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#080808]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-yellow-500 dark:text-yellow-400" />
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest">Files</span>
        </div>
        <button onClick={onAddFile} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/[0.08] text-gray-500 transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map(f => (
          <div
            key={f.id}
            onClick={() => onSelectFile(f.id)}
            className={cn(
              'group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-all',
              activeFileId === f.id
                ? 'bg-black/5 dark:bg-white/[0.08] text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/[0.04] hover:text-gray-900 dark:hover:text-gray-200'
            )}
          >
            {getFileIcon(f.name)}
            <span className="text-[12px] flex-1 truncate font-mono">{f.name}</span>
            <button
              onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-white/10 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-gray-500 italic">No files yet</div>
        )}
      </div>
    </div>
  );
}

// ─── Code Editor ──────────────────────────────────────────────────────────────

function CodeEditor({ file, onChange }: { file: ProjectFile; onChange: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = file.content.split('\n');
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-[#0a0a0a]">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#111]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-500">{file.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/[0.06] text-gray-500">{LANG_MAP[file.language] ?? file.language.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-gray-600">{lines.length} lines</span>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-black/5 dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/[0.1] text-gray-600 dark:text-gray-400 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
      </div>
      {/* Editable code area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <div className="w-10 bg-gray-100 dark:bg-[#080808] border-r border-gray-200 dark:border-white/[0.04] text-right py-4 px-2 shrink-0 overflow-hidden pointer-events-none select-none">
            {lines.map((_, i) => (
              <div key={i} className="text-[11px] font-mono text-gray-400 dark:text-gray-700 leading-5">{i + 1}</div>
            ))}
          </div>
          <textarea
            value={file.content}
            onChange={e => onChange(e.target.value)}
            spellCheck={false}
            className="flex-1 bg-transparent text-[12px] font-mono text-gray-800 dark:text-gray-300 leading-5 resize-none outline-none px-4 py-4 overflow-auto"
            style={{ tabSize: 2 }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── ClarifyCard ──────────────────────────────────────────────────────────────

function ClarifyCard({ msg, onAnswer, onSubmit }: {
  msg: Message;
  onAnswer: (msgId: string, qId: string, optId: string) => void;
  onSubmit: (msgId: string) => void;
}) {
  const allAnswered = msg.questions?.every(q => q.selectedIds.length > 0);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
      className="w-full max-w-lg space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center ring-1 ring-violet-200 dark:ring-violet-500/30">
          <Brain className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
        </div>
        <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 tracking-widest uppercase">Arc is analyzing your project</span>
      </div>
      {msg.questions?.map((q, qi) => (
        <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: qi * 0.1 }}
          className="rounded-2xl overflow-hidden arc-glass backdrop-blur-xl">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{q.question}</p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{q.type === 'multi' ? 'Choose all that apply' : 'Pick one'}</p>
          </div>
          <div className="px-4 pb-4 grid gap-2">
            {q.options.map(opt => {
              const selected = q.selectedIds.includes(opt.id);
              return (
                <motion.button key={opt.id} onClick={() => onAnswer(msg.id, q.id, opt.id)}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl transition-all duration-200 flex items-start gap-3',
                    selected
                      ? 'arc-btn-3d-active ring-1 ring-violet-500/50 bg-violet-50 dark:bg-violet-500/20'
                      : 'arc-btn-3d hover:ring-1 hover:ring-gray-300 dark:hover:ring-white/20'
                  )}>
                  <div className={cn(
                    'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                    selected ? 'border-violet-500 bg-violet-100 dark:border-violet-400 dark:bg-violet-400/20' : 'border-gray-300 dark:border-gray-600'
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />}
                  </div>
                  <div>
                    <p className={cn('text-sm font-medium leading-snug', selected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300')}>{opt.label}</p>
                    {opt.description && <p className="text-xs mt-0.5 text-gray-500">{opt.description}</p>}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      ))}
      <AnimatePresence>
        {allAnswered && !msg.questionsDone && (
          <motion.button initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
            onClick={() => onSubmit(msg.id)}
            className="w-full py-3.5 rounded-2xl arc-btn-3d-primary text-white text-sm font-semibold flex items-center justify-center gap-2">
            <Wand2 className="w-4 h-4" />
            Generate my build plan
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({ msg, onApprove, onReject }: {
  msg: Message;
  onApprove: (msgId: string) => void;
  onReject: (msgId: string) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg">
      <div className="rounded-2xl overflow-hidden arc-glass backdrop-blur-xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-200 dark:ring-emerald-500/30">
              <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{msg.planLabel}</p>
              <p className="text-xs text-gray-500">{msg.plan?.length} steps • Review and approve</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
          {msg.plan?.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3.5 px-5 py-3.5">
              <div className="w-6 h-6 rounded-lg bg-gray-50 dark:bg-white/[0.05] border border-gray-200 dark:border-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-gray-500">{i + 1}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{step.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
        {!msg.planApproved && (
          <div className="px-5 py-4 flex gap-2.5 border-t border-gray-200 dark:border-white/[0.06]">
            <button onClick={() => onApprove(msg.id)}
              className="flex-1 py-2.5 rounded-xl arc-btn-3d-primary text-white text-sm font-semibold flex items-center justify-center gap-2">
              <Rocket className="w-4 h-4" /> Start Building
            </button>
            <button onClick={() => onReject(msg.id)}
              className="px-4 py-2.5 rounded-xl arc-btn-3d text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {msg.planApproved && (
          <div className="px-5 py-3 flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs border-t border-gray-200 dark:border-white/[0.06]">
            <CheckCircle2 className="w-4 h-4" /> Plan approved — building now
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── AgentProgress ────────────────────────────────────────────────────────────

function AgentProgress({ steps }: { steps: AgentStep[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm arc-glass rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/[0.06] flex items-center gap-2">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
          <Cpu className="w-4 h-4 text-violet-500 dark:text-violet-400" />
        </motion.div>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Arc is building…</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-white/[0.04]">
        {steps.map((step, i) => (
          <div key={step.id}>
            <button
              onClick={() => step.detail ? setExpandedId(expandedId === step.id ? null : step.id) : null}
              className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/[0.03]">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all',
                step.status === 'done' ? 'bg-emerald-100 dark:bg-emerald-500/20 ring-1 ring-emerald-200 dark:ring-emerald-500/40' :
                  step.status === 'active' ? 'bg-violet-100 dark:bg-violet-500/20 ring-1 ring-violet-300 dark:ring-violet-400/60 ring-offset-1 dark:ring-offset-black/30' :
                    'bg-gray-100 dark:bg-white/[0.04] ring-1 ring-gray-200 dark:ring-white/[0.06]'
              )}>
                {step.status === 'done' && <Check className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />}
                {step.status === 'active' && (
                  <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-violet-500 dark:bg-violet-400" />
                )}
                {step.status === 'pending' && <span className="text-[9px] font-bold text-gray-400 dark:text-gray-600">{i + 1}</span>}
              </div>
              <span className={cn(
                'text-sm flex-1 transition-colors',
                step.status === 'done' ? 'text-gray-500 dark:text-gray-600 line-through' :
                  step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-600'
              )}>{step.label}</span>
              {step.detail && <ChevronDown className={cn('w-3.5 h-3.5 text-gray-400 dark:text-gray-600 transition-transform', expandedId === step.id && 'rotate-180')} />}
            </button>
            <AnimatePresence>
              {expandedId === step.id && step.detail && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <div className="px-5 pb-3 pl-[52px] text-[11px] text-gray-500 font-mono bg-black/5 dark:bg-white/[0.02]">{step.detail}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ─── ThinkingDots ─────────────────────────────────────────────────────────────

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

// ─── Main Builder Component ────────────────────────────────────────────────────

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentPage, setCurrentPage] = useState('Builder');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs' | 'code'>('preview');
  const { theme } = useTheme();
  
  // Manage safe isDark logic to prevent hydration mismatch
  const [isDark, setIsDark] = useState(true);
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

  const [phase, setPhase] = useState<'idle' | 'ai_questioning' | 'questioning' | 'ai_planning' | 'planning' | 'building' | 'chatting'>('idle');
  const [pendingUserText, setPendingUserText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const buildStartRef = useRef<number>(0);

  // ── Online status ─────────────────────────────────────────────────────────

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  // ── Mobile + resize ────────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);

  // ── Console interceptor ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ARC_CONSOLE') {
        setConsoleLogs(prev => [...prev, {
          id: `${Date.now()}-${Math.random()}`,
          type: event.data.level,
          message: event.data.args.join(' '),
          timestamp: new Date(),
        }]);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Textarea auto-resize ───────────────────────────────────────────────────

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, type, message, timestamp: new Date() }]);
  }, []);

  const isInputDisabled = phase !== 'idle';

  const activeFile = projectFiles.find(f => f.id === activeFileId) ?? null;

  const filteredMessages = searchQuery
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  // ── File management ────────────────────────────────────────────────────────

  const addFile = () => {
    const name = prompt('File name (e.g. style.css):');
    if (!name) return;
    const ext = name.split('.').pop() ?? 'txt';
    const newFile: ProjectFile = { id: `file-${Date.now()}`, name, language: ext, content: '' };
    setProjectFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
    setActiveTab('code');
  };

  const deleteFile = (id: string) => {
    setProjectFiles(prev => prev.filter(f => f.id !== id));
    if (activeFileId === id) {
      setActiveFileId(projectFiles.find(f => f.id !== id)?.id ?? null);
    }
  };

  const updateFileContent = (id: string, content: string) => {
    setProjectFiles(prev => prev.map(f => f.id === id ? { ...f, content } : f));
  };

  // ── Controls ───────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (projectFiles.length > 0) {
      projectFiles.forEach(file => {
        const blob = new Blob([file.content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
      });
    } else if (previewCode) {
      const blob = new Blob([previewCode], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'index.html';
      a.click();
    }
    addLog('system', 'Project files downloaded.');
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  const pushHistory = useCallback((files: ProjectFile[], label: string) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, { id: Date.now().toString(), files, label, timestamp: new Date() }];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const prev = history[historyIndex - 1];
    setHistoryIndex(i => i - 1);
    setProjectFiles(prev.files);
    const htmlFile = prev.files.find(f => f.language === 'html');
    if (htmlFile) setPreviewCode(CONSOLE_INTERCEPTOR + htmlFile.content);
    addLog('system', `Reverted to: ${prev.label}`);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const next = history[historyIndex + 1];
    setHistoryIndex(i => i + 1);
    setProjectFiles(next.files);
    const htmlFile = next.files.find(f => f.language === 'html');
    if (htmlFile) setPreviewCode(CONSOLE_INTERCEPTOR + htmlFile.content);
    addLog('system', `Redid: ${next.label}`);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    addLog('system', 'Stream cancelled by user.');
    setPhase('idle');
  };

  const handleNewProject = () => {
    abortRef.current?.abort();
    setMessages([]);
    setPreviewCode('');
    setProjectFiles([]);
    setActiveFileId(null);
    setLogs([{ id: Date.now().toString(), type: 'system', message: 'Started new project.', timestamp: new Date() }]);
    setConsoleLogs([]);
    setSessionId(null);
    setIsStreaming(false);
    setHistory([]);
    setHistoryIndex(-1);
    setPhase('idle');
    setPendingUserText('');
    setTokenCount(0);
    setBuildTime(null);
    if (isMobile) setMobileView('chat');
  };

  // ── Standard Chat Stream ───────────────────────────────────────────────────

  const handleStandardChatStream = async (userText: string, thinkingId: string) => {
    setMessages(prev => prev.filter(m => m.id !== thinkingId));
    const chatMsgId = `chat-${Date.now()}`;
    setMessages(prev => [...prev, { id: chatMsgId, role: 'agent', content: '', status: 'streaming', timestamp: new Date() }]);
    setPhase('chatting');

    try {
      let sid = sessionId || `fallback-${Date.now()}`;
      const systemContext = projectFiles.length > 0 
        ? `Current files in project: ${projectFiles.map(f => f.name).join(', ')}.`
        : 'No files in current project.';
      const prompt = `You are Arc, an AI frontend developer. Answer the user's question concisely. ${systemContext}\nUser: "${userText}"`;
      
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
            const chunkText = extractChunkText(line);
            if (chunkText) {
              fullText += chunkText;
              setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, content: fullText } : m));
            }
          }
        }
      }
      setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, status: 'done' } : m));
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setMessages(prev => prev.map(m => m.id === chatMsgId ? { ...m, content: 'Failed to fetch response.', status: 'error' } : m));
    } finally {
      setPhase('idle');
    }
  };

  // ── QA & Planning ──────────────────────────────────────────────────────────

  const handleAnswer = (msgId: string, qId: string, optId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const questions = m.questions?.map(q => {
        if (q.id !== qId) return q;
        const already = q.selectedIds.includes(optId);
        const selectedIds = q.type === 'multi'
          ? already ? q.selectedIds.filter(id => id !== optId) : [...q.selectedIds, optId]
          : [optId];
        return { ...q, selectedIds };
      });
      return { ...m, questions };
    }));
  };

  const handleQuestionsSubmit = async (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, questionsDone: true, status: 'planning' } : m));
    setPhase('ai_planning');

    const questionMsg = messages.find(m => m.id === msgId);
    const answers: Record<string, string[]> = {};
    questionMsg?.questions?.forEach(q => {
      answers[q.question] = q.options.filter(o => q.selectedIds.includes(o.id)).map(o => o.label);
    });

    const thinkingId = `thinking-plan-${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'agent', content: '', status: 'thinking', timestamp: new Date() }]);
    addLog('agent', 'Generating context-aware build plan…');

    try {
      const { label, steps, files } = await generateAIPlan(pendingUserText, answers);
      const planMsgId = `plan-${Date.now()}`;
      setMessages(prev => prev.filter(m => m.id !== thinkingId).concat({
        id: planMsgId, role: 'agent',
        content: `Here's your build plan for: **${label}**\nFiles: ${files?.join(', ') ?? 'index.html'}`,
        status: 'awaiting_approval', timestamp: new Date(), planLabel: label, plan: steps,
      }));
      setPhase('planning');
      addLog('system', `Plan ready: ${label}`);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setPhase('idle');
      addLog('error', 'Failed to generate plan. Please try again.');
    }
  };

  const handleApprovePlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, planApproved: true } : m));
    setPhase('building');
    startBuild();
  };

  const handleRejectPlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId
      ? { ...m, status: 'error', content: 'Plan rejected. Describe what you\'d like differently.' }
      : m));
    setPhase('idle');
  };

  // ── Start Build ─────────────────────────────────────────────────────────────

  const startBuild = async (overrideText?: string) => {
    const userText = overrideText || pendingUserText;
    setIsStreaming(true);
    buildStartRef.current = Date.now();
    if (isMobile) setMobileView('preview');
    setActiveTab('logs');

    const buildMsgId = `build-${Date.now()}`;
    
    setMessages(prev => [...prev, {
      id: buildMsgId, role: 'agent', content: '', status: 'building',
      timestamp: new Date(), agentSteps: [{ id: 'init', label: 'Connecting to Arc engine', status: 'active' }],
    }]);

    let currentStepId = 'init';
    const addStep = (id: string, label: string, detail?: string) => {
      if (currentStepId === id) return;
      currentStepId = id;
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map(s => s.status === 'active' ? { ...s, status: 'done' as const } : s) || [];
        if (!steps.find(s => s.id === id)) {
          steps.push({ id, label, detail, status: 'active' });
        }
        return { ...m, agentSteps: steps };
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
          addLog('error', 'Session fallback mode.');
        }
      }
      addStep('auth', 'Authenticating build session', `session_id: ${sid?.slice(0, 8)}`);

      let fileContext = projectFiles.length > 0 
        ? projectFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}\n=== END FILE ===`).join('\n\n')
        : '';

      const systemPrompt = `You are Arc, an elite AI frontend developer producing production-quality, multi-file web projects.

User request: "${userText}"
${fileContext ? `\nCurrent Files:\n${fileContext}\n\nUpdate existing files or create new ones based on the request.` : ''}

CRITICAL MULTI-FILE OUTPUT FORMAT:
Output ALL files using this EXACT format:

=== FILE: index.html ===
<!DOCTYPE html>
... html ...
=== END FILE ===

=== FILE: style.css ===
... css ...
=== END FILE ===

REQUIREMENTS:
- Design quality: Vercel/Linear/Stripe level.
- Fully responsive (mobile-first).
- Link external CSS/JS properly.
- Use step tags for reasoning: <step>reasoning here</step>

Start with reasoning steps, then output files.`;

      addStep('request', 'Analyzing design requirements');

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: systemPrompt }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body reader available.');

      const decoder = new TextDecoder();
      let carryover = '';
      let fullText = '';
      const seenSteps = new Set<string>();
      let totalChars = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = carryover + decoder.decode(value, { stream: true });
        const lines = raw.split('\n');
        carryover = lines.pop() ?? '';

        for (const line of lines) {
          const chunkText = extractChunkText(line);
          if (!chunkText) continue;
          fullText += chunkText;
          totalChars += chunkText.length;
          setTokenCount(Math.round(totalChars / 4));

          // Extract reasoning steps
          const stepMatches = [...fullText.matchAll(/<step>([\s\S]*?)<\/step>/g)];
          for (const m of stepMatches) {
            const stepMsg = m[1].trim();
            if (stepMsg && !seenSteps.has(stepMsg)) {
              seenSteps.add(stepMsg);
              addLog('agent', stepMsg);
              const shortLabel = stepMsg.split('.')[0].slice(0, 45) + '...';
              addStep(`step-${seenSteps.size}`, shortLabel);
            }
          }

          // Parse multi-file format in real-time
          const fileMatches = [...fullText.matchAll(/=== FILE: (.+?) ===\n([\s\S]*?)(?:=== END FILE ===|(?==== FILE:)|$)/g)];
          if (fileMatches.length > 0) {
            const latestFile = fileMatches[fileMatches.length - 1][1].trim();
            addStep(`file-${latestFile}`, `Writing ${latestFile}...`);

            const parsedFiles: ProjectFile[] = fileMatches.map(m => {
              const name = m[1].trim();
              const content = m[2].trim();
              const ext = name.split('.').pop() ?? 'txt';
              return { id: `file-${name}`, name, language: ext, content };
            });

            // Merge with existing files to support modifications
            setProjectFiles(prev => {
              const updated = [...prev];
              parsedFiles.forEach(pf => {
                const existingIdx = updated.findIndex(f => f.name === pf.name);
                if (existingIdx !== -1) updated[existingIdx] = pf;
                else updated.push(pf);
              });
              return updated;
            });

            if (!activeFileId && parsedFiles.length > 0) setActiveFileId(parsedFiles[0].id);

            // Update preview
            const htmlFile = parsedFiles.find(f => f.language === 'html');
            if (htmlFile) {
              let previewHtml = htmlFile.content;
              const cssFile = parsedFiles.find(f => f.language === 'css');
              const jsFile = parsedFiles.find(f => f.language === 'js');
              if (cssFile) previewHtml = previewHtml.replace('</head>', `<style>${cssFile.content}</style></head>`);
              if (jsFile) previewHtml = previewHtml.replace('</body>', `<script>${jsFile.content}<\/script></body>`);
              setPreviewCode(CONSOLE_INTERCEPTOR + previewHtml);
            }
          }
        }
      }

      // Final Extraction Fallback
      addStep('finalize', 'Finalizing & optimizing layout');
      let finalFiles = projectFiles.length > 0 ? projectFiles : [];
      
      if (finalFiles.length === 0) {
        // Fallback robust markdown/HTML extractor
        const codeFallbackMatch = fullText.match(/```(?:html)?\s*([\s\S]*?)```/);
        let currentCode = codeFallbackMatch ? codeFallbackMatch[1].trim() : '';
        if (!currentCode && fullText.includes('<html')) {
          currentCode = fullText.slice(fullText.indexOf('<html'));
        }
        
        if (currentCode) {
          setPreviewCode(CONSOLE_INTERCEPTOR + currentCode);
          const singleFile: ProjectFile = { id: 'file-index', name: 'index.html', language: 'html', content: currentCode };
          setProjectFiles([singleFile]);
          setActiveFileId('file-index');
          finalFiles = [singleFile];
        }
      }

      const elapsed = Math.round((Date.now() - buildStartRef.current) / 1000);
      setBuildTime(elapsed);

      if (finalFiles.length > 0 || previewCode) {
        pushHistory(finalFiles, userText.slice(0, 30));
        const lineCount = finalFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0);
        
        setMessages(prev => prev.map(m => {
          if (m.id !== buildMsgId) return m;
          const finishedSteps = m.agentSteps?.map(s => ({ ...s, status: 'done' as const })) || [];
          return { ...m, status: 'done', agentSteps: finishedSteps, content: `✅ Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} in ${elapsed}s — ${lineCount} lines`, codeLines: lineCount };
        }));
        
        addLog('system', `Done. ${finalFiles.length} files, ${lineCount} lines in ${elapsed}s.`);
        setActiveTab('preview');
        if (finalFiles.length > 0) setShowFileTree(true);
      } else {
        throw new Error('No code extracted from response.');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.map(m => m.id === buildMsgId ? { ...m, status: 'error', content: 'Build stopped.' } : m));
        return;
      }
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', errMsg);
      setMessages(prev => prev.map(m => m.id === buildMsgId ? { ...m, status: 'error', content: `Build failed: ${errMsg}` } : m));
    } finally {
      setIsStreaming(false);
      setPhase('idle');
    }
  };

  // ── Submit Logic ────────────────────────────────────────────────────────────

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || phase !== 'idle') return;

    setInput('');
    setPendingUserText(text);

    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }]);
    
    const thinkingId = `thinking-ai-${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'agent', content: '', status: 'thinking', timestamp: new Date() }]);
    setPhase('ai_questioning');
    addLog('agent', `Analyzing intent for: "${text}"`);

    let intent: 'chat' | 'build' | 'modify' = projectFiles.length === 0 ? 'build' : 'modify';
    try {
      intent = await detectIntent(text);
    } catch (err) {}

    if (intent === 'chat') {
      await handleStandardChatStream(text, thinkingId);
    } else if (intent === 'modify') {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      startBuild(text);
    } else {
      // Build new project -> Clarification Flow
      try {
        const questions = await generateAIQuestions(text);
        const qMsgId = `questions-${Date.now()}`;
        setMessages(prev => prev.filter(m => m.id !== thinkingId).concat({
          id: qMsgId, role: 'agent', content: '', status: 'questioning',
          timestamp: new Date(), questions, intent,
        }));
        setPhase('questioning');
        addLog('system', 'Clarifying questions generated.');
      } catch {
        // Fallback to build directly if questions fail
        setMessages(prev => prev.filter(m => m.id !== thinkingId));
        startBuild(text);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        :root {
          --arc-glass-bg: rgba(255, 255, 255, 0.8);
          --arc-glass-border: rgba(0, 0, 0, 0.08);
          --arc-btn-bg: linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%);
          --arc-btn-border: rgba(0, 0, 0, 0.1);
          --arc-btn-shadow: 0 1px 2px rgba(0,0,0,0.05);
          --arc-btn-color: #374151;
        }
        .dark {
          --arc-glass-bg: rgba(255, 255, 255, 0.03);
          --arc-glass-border: rgba(255, 255, 255, 0.08);
          --arc-btn-bg: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%);
          --arc-btn-border: transparent;
          --arc-btn-shadow: 0 2px 8px rgba(0,0,0,0.3);
          --arc-btn-color: #9CA3AF;
        }
        .arc-glass {
          background: var(--arc-glass-bg);
          border: 1px solid var(--arc-glass-border);
        }
        .arc-btn-3d {
          background: var(--arc-btn-bg);
          box-shadow: var(--arc-btn-shadow);
          border: 1px solid var(--arc-btn-border);
          color: var(--arc-btn-color);
          transition: all 0.15s ease;
        }
        .arc-btn-3d:hover {
          transform: translateY(-1px);
          filter: brightness(1.05);
        }
        .arc-btn-3d:active { 
          transform: translateY(0px); 
        }
        .arc-btn-3d-active {
          background: linear-gradient(180deg, rgba(139,92,246,0.15) 0%, rgba(109,40,217,0.05) 100%);
          border: 1px solid rgba(139,92,246,0.3);
        }
        .dark .arc-btn-3d-active {
          background: linear-gradient(180deg, rgba(139,92,246,0.25) 0%, rgba(109,40,217,0.15) 100%);
        }
        .arc-btn-3d-primary {
          background: linear-gradient(180deg, rgba(139,92,246,0.9) 0%, rgba(109,40,217,0.85) 100%);
          box-shadow: 0 2px 10px rgba(139,92,246,0.3);
          transition: all 0.15s ease;
          border: none;
        }
        .arc-btn-3d-primary:hover {
          box-shadow: 0 4px 15px rgba(139,92,246,0.4);
          transform: translateY(-1px);
        }
        .arc-input-glass {
          background: var(--arc-glass-bg);
          border: 1px solid var(--arc-glass-border);
          box-shadow: 0 4px 20px rgba(0,0,0,0.05);
        }
        .dark .arc-input-glass { box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .arc-input-glass:focus-within {
          border-color: rgba(139,92,246,0.4);
          box-shadow: 0 0 0 3px rgba(139,92,246,0.12);
        }
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
                <Sidebar
                  currentPage={currentPage}
                  setCurrentPage={(page) => { setCurrentPage(page); setSidebarOpen(false); }}
                  isOpen={true}
                  onClose={() => setSidebarOpen(false)}
                />
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
                  <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search messages, commands…"
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none"
                  />
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-600">ESC</kbd>
                </div>
                <div className="p-2">
                  {[
                    { icon: Plus, label: 'New project', shortcut: '⌘N', action: () => { handleNewProject(); setSearchOpen(false); } },
                    { icon: Download, label: 'Download files', shortcut: '', action: () => { handleDownload(); setSearchOpen(false); } },
                    { icon: Share, label: 'Share project', shortcut: '', action: () => { handleShare(); setSearchOpen(false); } },
                    { icon: RotateCcw, label: 'Undo', shortcut: '⌘Z', action: () => { handleUndo(); setSearchOpen(false); } },
                  ].filter(c => !searchQuery || c.label.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(cmd => (
                      <button key={cmd.label} onClick={cmd.action}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/[0.06] transition-colors text-left">
                        <cmd.icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{cmd.label}</span>
                        {cmd.shortcut && <kbd className="text-[10px] text-gray-400 dark:text-gray-600">{cmd.shortcut}</kbd>}
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
              <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> Link copied to clipboard
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main layout */}
        <div className="flex flex-col flex-1 min-w-0 h-full">
          
          {/* Top bar */}
          <div className="h-12 shrink-0 border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-2 bg-white/80 dark:bg-black/40 backdrop-blur-xl">
            <button onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg arc-btn-3d text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
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
              <div className={cn('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-red-500 dark:bg-red-400')} />
              <span className="text-[10px] text-gray-500 dark:text-gray-600 font-mono hidden sm:block">{isOnline ? 'online' : 'offline'}</span>
            </div>

            {isStreaming && tokenCount > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 font-mono ml-2">
                <Activity className="w-3 h-3 animate-pulse" />
                {tokenCount.toLocaleString()} tokens
              </div>
            )}

            {buildTime && !isStreaming && (
              <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-600 font-mono ml-2">
                <Clock className="w-3 h-3" />
                {buildTime}s
              </div>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5">
              <button onClick={() => setSearchOpen(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg arc-btn-3d">
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Search</span>
                <kbd className="text-[10px] text-gray-400 dark:text-gray-700 hidden sm:block">⌘K</kbd>
              </button>
              {history.length > 1 && (
                <>
                  <button onClick={handleUndo} className="p-1.5 rounded-lg arc-btn-3d">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleRedo} className="p-1.5 rounded-lg arc-btn-3d">
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
                  <button onClick={handleShare}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg arc-btn-3d">
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
              isMobile ? (mobileView === 'chat' ? 'w-full' : 'hidden') : messages.length > 0 ? 'w-[380px] shrink-0' : 'flex-1'
            )}>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto arc-scrollbar px-4 py-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-8 relative">
                    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-600/5 dark:bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4 relative">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-500/40">
                          <Zap className="w-8 h-8 text-white" />
                        </div>
                      </div>
                      <div className="text-center">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Arc AI Agent</h1>
                        <p className="text-sm text-gray-500 mt-1">Describe your project and I'll build it for you</p>
                      </div>
                    </motion.div>

                    <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                      {SUGGESTIONS.map((s, i) => (
                        <motion.button key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.07 }}
                          onClick={() => { setInput(s.text); textareaRef.current?.focus(); }}
                          className="text-left p-3 rounded-xl arc-btn-3d group flex flex-col gap-2">
                          <span className="opacity-80">{s.icon}</span>
                          <p className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-300 transition-colors leading-snug">{s.text}</p>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {filteredMessages.map((msg) => (
                      <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                        {msg.status === 'thinking' && <ThinkingDots />}
                        {msg.status === 'questioning' && msg.questions && (
                          <ClarifyCard msg={msg} onAnswer={handleAnswer} onSubmit={handleQuestionsSubmit} />
                        )}
                        {(msg.status === 'awaiting_approval' || msg.status === 'done' && msg.plan) && (
                          <PlanCard msg={msg} onApprove={handleApprovePlan} onReject={handleRejectPlan} />
                        )}
                        {msg.status === 'building' && msg.agentSteps && (
                          <AgentProgress steps={msg.agentSteps} />
                        )}
                        {msg.status === 'done' && !msg.plan && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="flex items-start gap-2.5 max-w-sm">
                            <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="arc-glass rounded-2xl px-4 py-3 text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                              {msg.content}
                            </div>
                          </motion.div>
                        )}
                        {msg.status === 'error' && (
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
                        {msg.role === 'user' && (
                          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm arc-btn-3d-primary text-white text-sm">
                            {msg.content}
                          </motion.div>
                        )}
                        {msg.role === 'agent' && !msg.status && msg.content && (
                          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                            {msg.content}
                          </motion.div>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input Area */}
              <div className={cn(
                "shrink-0 p-3 border-t border-gray-200 dark:border-white/[0.06] bg-white dark:bg-[#060608]", 
                isMobile && messages.length > 0 ? "pb-[calc(1rem+env(safe-area-inset-bottom)+3.5rem)]" : "pb-[calc(1rem+env(safe-area-inset-bottom))]"
              )}>
                <form onSubmit={handleSubmit}
                  className={cn('flex flex-col gap-2 rounded-2xl arc-input-glass p-3', isStreaming && 'opacity-80')}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isInputDisabled ? 'Arc is working…' : 'Describe what you want to build or ask…'}
                    disabled={isInputDisabled}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-500 resize-none outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-600">
                      <Hash className="w-3 h-3" />
                      <span>Shift+Enter for newline</span>
                    </div>
                    {isStreaming ? (
                      <button type="button" onClick={handleStop}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors">
                        <X className="w-3.5 h-3.5" /> Stop
                      </button>
                    ) : (
                      <button type="submit" disabled={!input.trim() || isInputDisabled}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold disabled:opacity-30">
                        <Sparkles className="w-3.5 h-3.5" /> Send
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>

            {/* Preview panel */}
            {messages.length > 0 && (
              <div className={cn(
                'flex flex-col h-full transition-all duration-500',
                isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0 z-20' : 'hidden') : 'flex-1',
                isPreviewFullscreen ? 'fixed inset-0 z-50 bg-gray-50 dark:bg-[#060608]' : ''
              )}>
                {/* Tab bar */}
                <div className="h-11 shrink-0 border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-1 bg-white/50 dark:bg-black/30 backdrop-blur-xl justify-between">
                  <div className="flex items-center gap-1">
                    {[
                      { id: 'preview', icon: Eye, label: 'Preview' },
                      { id: 'code', icon: Code2, label: `Code${projectFiles.length > 0 ? ` (${projectFiles.length})` : ''}` },
                      { id: 'console', icon: Terminal, label: `Console${consoleLogs.length ? ` (${consoleLogs.length})` : ''}` },
                      { id: 'logs', icon: Activity, label: `Logs` },
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
                            className={cn(
                              'p-1.5 rounded-md transition-all',
                              previewDevice === d ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-white shadow-sm dark:shadow-none' : 'text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400'
                            )}>
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

                    <button onClick={() => setIsPreviewFullscreen(f => !f)}
                      className="p-1.5 rounded-lg arc-btn-3d">
                      {isPreviewFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="flex flex-1 min-h-0 bg-gray-50 dark:bg-[#060608]">
                  
                  {/* File tree sidebar */}
                  {activeTab === 'code' && showFileTree && projectFiles.length > 0 && (
                    <div className="w-44 shrink-0 border-r border-gray-200 dark:border-white/[0.06]">
                      <FileTree
                        files={projectFiles}
                        activeFileId={activeFileId}
                        onSelectFile={(id) => { setActiveFileId(id); }}
                        onDeleteFile={deleteFile}
                        onAddFile={addFile}
                      />
                    </div>
                  )}

                  <div className="flex-1 relative overflow-hidden">
                    
                    {/* Preview tab */}
                    {activeTab === 'preview' && (
                      <div className="w-full h-full flex flex-col items-center p-4">
                        <div
                          className="bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-white/[0.08] shadow-2xl transition-all duration-500 flex flex-col relative"
                          style={{
                            width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px',
                            maxWidth: '100%', height: '100%',
                          }}>
                          {/* Browser chrome */}
                          <div className="h-9 shrink-0 bg-gray-100 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-white/[0.06] flex items-center px-3 gap-2">
                            <div className="flex gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-400 dark:bg-red-500/70" />
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 dark:bg-amber-500/70" />
                              <div className="w-2.5 h-2.5 rounded-full bg-green-400 dark:bg-green-500/70" />
                            </div>
                            <div className="mx-auto flex-1 max-w-xs h-5 bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-transparent rounded-md flex items-center justify-center text-[10px] text-gray-500 dark:text-gray-600 font-mono">
                              localhost:3000
                            </div>
                            {previewCode && (
                              <button
                                onClick={() => {
                                  const win = window.open('', '_blank');
                                  if (win) { win.document.write(previewCode); win.document.close(); }
                                }}
                                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-500 dark:text-gray-600 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          
                          <div className="relative flex-1 bg-white">
                            <AnimatePresence>
                              {isStreaming && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                  className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-[#060608]/90 backdrop-blur-sm">
                                  <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                    className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                                    <Zap className="w-6 h-6 text-white" />
                                  </motion.div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-gray-300 mt-4">Building your project…</p>
                                  <p className="text-xs text-gray-500 dark:text-gray-600 mt-1 font-mono">{tokenCount > 0 ? `${tokenCount.toLocaleString()} tokens` : 'Connecting…'}</p>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            {previewCode
                              ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                              : !isStreaming && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-600">
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
                          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 dark:text-gray-600">
                            <FileCode2 className="w-8 h-8 opacity-40" />
                            <span className="text-sm opacity-80">No files yet</span>
                          </div>
                        ) : activeFile ? (
                          <CodeEditor
                            file={activeFile}
                            onChange={(content) => updateFileContent(activeFile.id, content)}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            Select a file to view code
                          </div>
                        )}
                      </div>
                    )}

                    {/* Console & Logs */}
                    {activeTab === 'console' && (
                      <div className="w-full h-full bg-white dark:bg-[#080808] text-gray-800 dark:text-gray-300 font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        {consoleLogs.map((log) => (
                          <div key={log.id} className={cn('flex gap-2 mb-1.5', log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-amber-500' : '')}>
                            <span className="text-gray-400 dark:text-gray-600">{log.timestamp.toLocaleTimeString()}</span>
                            <span className="whitespace-pre-wrap">{log.message}</span>
                          </div>
                        ))}
                        <div ref={consoleEndRef} />
                      </div>
                    )}

                    {activeTab === 'logs' && (
                      <div className="w-full h-full bg-white dark:bg-[#080808] font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        <div className="mb-3 flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
                          <span className="text-violet-600 dark:text-violet-400 font-semibold">Arc Terminal</span>
                        </div>
                        {logs.map((log, i) => (
                          <div key={log.id} className={cn(
                            'flex gap-2 mb-1.5 leading-relaxed',
                            log.type === 'system' ? 'text-emerald-600 dark:text-emerald-400' : log.type === 'error' ? 'text-red-600 dark:text-red-400' : log.type === 'info' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-400'
                          )}>
                            <span className="shrink-0 text-gray-400 dark:text-gray-600">{log.timestamp.toLocaleTimeString()}</span>
                            <span className="shrink-0 text-gray-500 dark:text-gray-700">[{log.type.slice(0,3)}]</span>
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
        {isMobile && messages.length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 h-14 border-t border-gray-200 dark:border-white/[0.06] flex bg-white/90 dark:bg-black/80 backdrop-blur-xl z-30 pb-[env(safe-area-inset-bottom)]">
            <button onClick={() => setMobileView('chat')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'chat' ? 'text-violet-600 dark:text-white' : 'text-gray-500 dark:text-gray-600')}>
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button onClick={() => setMobileView('preview')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'preview' ? 'text-violet-600 dark:text-white' : 'text-gray-500 dark:text-gray-600')}>
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>
        )}
      </div>
    </>
  );
}
--- END OF FILE Builder.tsx ---
