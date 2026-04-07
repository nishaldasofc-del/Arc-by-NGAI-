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
  ExternalLink, Clock, FileText, Braces, Image, Database
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
  agentSteps?: AgentStep[];
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
  { icon: '🛍️', text: 'Build a modern SaaS pricing page' },
  { icon: '🎨', text: 'Create a personal portfolio with animations' },
  { icon: '📊', text: 'Design a dashboard with live charts' },
  { icon: '🚀', text: 'Build an app landing page with waitlist' },
  { icon: '🌐', text: 'Create a multi-page website with nav' },
  { icon: '💳', text: 'Build an e-commerce product page' },
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

async function generateAIQuestions(userText: string): Promise<ClarifyQuestion[]> {
  const prompt = `You are Arc, an elite AI frontend developer agent.
User wants to build: "${userText}"

Generate 2-3 sharp clarifying questions. Return ONLY valid JSON array, no markdown:
[{"id":"q1","question":"...","type":"single","options":[{"id":"q1_a","label":"...","description":"..."}]}]
Rules: type is single/multi, 2-4 options each, concrete not vague, tied to their specific request.`;
  try {
    const raw = await callAI(prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned).map((q: ClarifyQuestion) => ({ ...q, selectedIds: [] }));
  } catch {
    return [{
      id: 'q1', question: 'What visual style do you want?', type: 'single',
      options: [
        { id: 'q1_a', label: 'Glassmorphism', description: 'Frosted glass, blur effects, depth' },
        { id: 'q1_b', label: 'Minimal & clean', description: 'White space, sharp typography' },
        { id: 'q1_c', label: 'Dark premium', description: 'Dark bg, neon accents, depth' },
      ], selectedIds: [],
    }];
  }
}

async function generateAIPlan(userText: string, answers: Record<string, string[]>): Promise<{ label: string; steps: PlanStep[]; files: string[] }> {
  const answerSummary = Object.entries(answers).map(([q, opts]) => `- ${q}: ${opts.join(', ')}`).join('\n');
  const prompt = `You are Arc, elite AI frontend developer.
User wants: "${userText}"
Their answers: ${answerSummary}

Return ONLY valid JSON (no markdown):
{"label":"Short title (max 40 chars)","files":["index.html","style.css","app.js"],"steps":[{"id":"p1","title":"...","description":"..."}]}
Rules: 4-5 steps, specific titles, list the actual files you'll create, ordered by implementation.`;
  try {
    const raw = await callAI(prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      label: userText.slice(0, 40),
      files: ['index.html', 'style.css', 'app.js'],
      steps: [
        { id: 'p1', title: 'Design system & layout', description: 'Typography, color tokens, responsive grid' },
        { id: 'p2', title: 'Build core components', description: 'Hero, nav, interactive elements' },
        { id: 'p3', title: 'Add animations', description: 'Scroll effects, hover states, transitions' },
        { id: 'p4', title: 'Polish & finalize', description: 'Responsiveness, accessibility, performance' },
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
      <span className="text-emerald-400">›</span>{' '}
      <span className="text-gray-300">{displayed}</span>
      {displayed.length < text.length && (
        <span className="inline-block w-1.5 h-3.5 bg-emerald-400 ml-0.5 animate-pulse align-middle" />
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
    if (['html'].includes(ext)) return <Globe className="w-3 h-3 text-orange-400" />;
    if (['css'].includes(ext)) return <Braces className="w-3 h-3 text-blue-400" />;
    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) return <FileCode2 className="w-3 h-3 text-yellow-400" />;
    if (['json'].includes(ext)) return <Database className="w-3 h-3 text-green-400" />;
    if (['md'].includes(ext)) return <FileText className="w-3 h-3 text-purple-400" />;
    if (['png', 'jpg', 'svg'].includes(ext)) return <Image className="w-3 h-3 text-pink-400" />;
    return <File className="w-3 h-3 text-gray-400" />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="w-3.5 h-3.5 text-yellow-400" />
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Files</span>
        </div>
        <button onClick={onAddFile} className="p-1 rounded hover:bg-white/[0.08] text-gray-500 hover:text-gray-300 transition-colors">
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
                ? 'bg-white/[0.08] text-white'
                : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
            )}
          >
            {getFileIcon(f.name)}
            <span className="text-[12px] flex-1 truncate font-mono">{f.name}</span>
            <button
              onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-gray-600 hover:text-red-400 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-gray-600 italic">No files yet</div>
        )}
      </div>
    </div>
  );
}

// ─── Code Editor (syntax highlighted view) ────────────────────────────────────

function CodeEditor({ file, onChange }: { file: ProjectFile; onChange: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = file.content.split('\n');
  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-[#111]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-500">{file.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-gray-500">{LANG_MAP[file.language] ?? file.language.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600">{lines.length} lines</span>
          <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-white/[0.05] hover:bg-white/[0.1] text-gray-400 transition-colors">
            {copied ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
      </div>
      {/* Editable code area */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 flex">
          {/* Line numbers */}
          <div className="w-10 bg-[#080808] border-r border-white/[0.04] text-right py-4 px-2 shrink-0 overflow-hidden pointer-events-none select-none">
            {lines.map((_, i) => (
              <div key={i} className="text-[11px] font-mono text-gray-700 leading-5">{i + 1}</div>
            ))}
          </div>
          <textarea
            value={file.content}
            onChange={e => onChange(e.target.value)}
            spellCheck={false}
            className="flex-1 bg-transparent text-[12px] font-mono text-gray-300 leading-5 resize-none outline-none px-4 py-4 overflow-auto"
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
        <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center ring-1 ring-violet-500/30">
          <Brain className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <span className="text-xs font-semibold text-violet-400 tracking-widest uppercase">Arc is analyzing your project</span>
      </div>
      {msg.questions?.map((q, qi) => (
        <motion.div key={q.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: qi * 0.1 }}
          className="rounded-2xl overflow-hidden arc-glass border border-white/[0.08] backdrop-blur-xl">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-white leading-snug">{q.question}</p>
            <p className="text-xs text-gray-500 mt-0.5">{q.type === 'multi' ? 'Choose all that apply' : 'Pick one'}</p>
          </div>
          <div className="px-4 pb-4 grid gap-2">
            {q.options.map(opt => {
              const selected = q.selectedIds.includes(opt.id);
              return (
                <motion.button key={opt.id} onClick={() => onAnswer(msg.id, q.id, opt.id)}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 flex items-start gap-3',
                    selected
                      ? 'arc-btn-3d-active border-violet-500/50 bg-violet-500/20'
                      : 'arc-btn-3d border-white/[0.08] hover:border-white/20'
                  )}>
                  <div className={cn(
                    'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                    selected ? 'border-violet-400 bg-violet-400/20' : 'border-gray-600'
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />}
                  </div>
                  <div>
                    <p className={cn('text-sm font-medium leading-snug', selected ? 'text-white' : 'text-gray-300')}>{opt.label}</p>
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
      <div className="rounded-2xl overflow-hidden arc-glass border border-white/[0.08] backdrop-blur-xl">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-500/30">
              <Layers className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{msg.planLabel}</p>
              <p className="text-xs text-gray-500">{msg.plan?.length} steps • Review and approve</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {msg.plan?.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3.5 px-5 py-3.5">
              <div className="w-6 h-6 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-gray-500">{i + 1}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-200">{step.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
        {!msg.planApproved && (
          <div className="px-5 py-4 flex gap-2.5 border-t border-white/[0.06]">
            <button onClick={() => onApprove(msg.id)}
              className="flex-1 py-2.5 rounded-xl arc-btn-3d-primary text-white text-sm font-semibold flex items-center justify-center gap-2">
              <Rocket className="w-4 h-4" /> Start Building
            </button>
            <button onClick={() => onReject(msg.id)}
              className="px-4 py-2.5 rounded-xl arc-btn-3d border border-white/10 text-gray-400 text-sm font-medium hover:text-red-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {msg.planApproved && (
          <div className="px-5 py-3 flex items-center gap-2 text-emerald-400 text-xs border-t border-white/[0.06]">
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
      className="w-full max-w-sm arc-glass border border-white/[0.08] rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-2">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
          <Cpu className="w-4 h-4 text-violet-400" />
        </motion.div>
        <span className="text-xs font-semibold text-gray-300">Arc is building…</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {steps.map((step, i) => (
          <div key={step.id}>
            <button
              onClick={() => step.detail ? setExpandedId(expandedId === step.id ? null : step.id) : null}
              className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.03]">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all',
                step.status === 'done' ? 'bg-emerald-500/20 ring-1 ring-emerald-500/40' :
                  step.status === 'active' ? 'bg-violet-500/20 ring-1 ring-violet-400/60 ring-offset-1 ring-offset-black/30' :
                    'bg-white/[0.04] ring-1 ring-white/[0.06]'
              )}>
                {step.status === 'done' && <Check className="w-2.5 h-2.5 text-emerald-400" />}
                {step.status === 'active' && (
                  <motion.div animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-violet-400" />
                )}
                {step.status === 'pending' && <span className="text-[9px] font-bold text-gray-600">{i + 1}</span>}
              </div>
              <span className={cn(
                'text-sm flex-1 transition-colors',
                step.status === 'done' ? 'text-gray-600 line-through' :
                  step.status === 'active' ? 'text-white font-medium' : 'text-gray-600'
              )}>{step.label}</span>
              {step.detail && <ChevronDown className={cn('w-3.5 h-3.5 text-gray-600 transition-transform', expandedId === step.id && 'rotate-180')} />}
            </button>
            <AnimatePresence>
              {expandedId === step.id && step.detail && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <div className="px-5 pb-3 pl-[52px] text-[11px] text-gray-500 font-mono bg-white/[0.02]">{step.detail}</div>
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
    <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl arc-glass border border-white/[0.08] w-fit">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-violet-400/60"
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
  const { theme, setTheme } = useTheme();

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

  const [phase, setPhase] = useState<'idle' | 'ai_questioning' | 'questioning' | 'ai_planning' | 'planning' | 'building'>('idle');
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

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(s => !s); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); handleNewProject(); }
    };
    window.addEventListener('keydown', handler as any);
    return () => window.removeEventListener('keydown', handler as any);
  }, []);

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

  // ── Download project ────────────────────────────────────────────────────────

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

  // ── Share ──────────────────────────────────────────────────────────────────

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 2500);
  };

  // ── History ────────────────────────────────────────────────────────────────

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

  // ── Answer clarify questions ───────────────────────────────────────────────

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

  // ── Submit answers → generate plan ────────────────────────────────────────

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

  // ── Approve plan ───────────────────────────────────────────────────────────

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

  // ── START BUILD (multi-file) ────────────────────────────────────────────────

  const startBuild = async () => {
    const userText = pendingUserText;
    setIsStreaming(true);
    buildStartRef.current = Date.now();
    if (isMobile) setMobileView('preview');
    setActiveTab('logs');

    const buildMsgId = `build-${Date.now()}`;
    const initialSteps: AgentStep[] = [
      { id: 's1', label: 'Initialising session', status: 'pending' },
      { id: 's2', label: 'Connecting to Arc engine', status: 'pending' },
      { id: 's3', label: 'Analysing design requirements', status: 'pending' },
      { id: 's4', label: 'Scaffolding file structure', status: 'pending' },
      { id: 's5', label: 'Generating HTML structure', status: 'pending' },
      { id: 's6', label: 'Applying styles & layout', status: 'pending' },
      { id: 's7', label: 'Adding interactivity', status: 'pending' },
      { id: 's8', label: 'Finalising & optimising', status: 'pending' },
    ];

    setMessages(prev => [...prev, {
      id: buildMsgId, role: 'agent', content: '', status: 'building',
      timestamp: new Date(), agentSteps: initialSteps,
    }]);

    const updateStep = (stepId: string, updates: Partial<AgentStep>) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        return { ...m, agentSteps: m.agentSteps?.map(s => s.id === stepId ? { ...s, ...updates } : s) };
      }));
    };

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      updateStep('s1', { status: 'active' });
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
      updateStep('s1', { status: 'done', detail: `session_id: ${sid?.slice(0, 8)}…` });
      updateStep('s2', { status: 'active' });

      const systemPrompt = `You are Arc, an elite AI frontend developer producing production-quality, multi-file web projects.

User request: "${userText}"

CRITICAL MULTI-FILE OUTPUT FORMAT:
Output multiple files using this EXACT format for each file:

=== FILE: index.html ===
<!DOCTYPE html>
... full html content ...
=== END FILE ===

=== FILE: style.css ===
... full css content ...
=== END FILE ===

=== FILE: app.js ===
... full js content ...
=== END FILE ===

REQUIREMENTS:
- Create at minimum: index.html, style.css, app.js
- Use modern CSS (custom properties, grid, flexbox, animations)
- Use vanilla JS or include CDN libs as needed
- Design quality: Vercel/Linear/Stripe level — glassmorphism, depth, micro-animations
- Fully responsive (mobile-first)
- index.html must link to style.css and app.js
- Each file must be COMPLETE and production ready
- Use step tags for reasoning: <step>reasoning here</step>

Start with reasoning steps, then output ALL files.`;

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: systemPrompt }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      updateStep('s2', { status: 'done' });
      updateStep('s3', { status: 'active' });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body reader available.');

      const decoder = new TextDecoder();
      let carryover = '';
      let fullText = '';
      const seenSteps = new Set<string>();
      let totalChars = 0;

      updateStep('s4', { status: 'active' });

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
            }
          }

          if (seenSteps.size >= 1) updateStep('s3', { status: 'done' });
          if (seenSteps.size >= 2) { updateStep('s4', { status: 'done' }); updateStep('s5', { status: 'active' }); }

          // Parse multi-file format in real-time
          const fileMatches = [...fullText.matchAll(/=== FILE: (.+?) ===\n([\s\S]*?)(?:=== END FILE ===|(?==== FILE:)|$)/g)];
          if (fileMatches.length > 0) {
            updateStep('s5', { status: 'active' });
            const parsedFiles: ProjectFile[] = fileMatches.map(m => {
              const name = m[1].trim();
              const content = m[2].trim();
              const ext = name.split('.').pop() ?? 'txt';
              return { id: `file-${name}`, name, language: ext, content };
            });

            setProjectFiles(parsedFiles);
            if (!activeFileId && parsedFiles.length > 0) setActiveFileId(parsedFiles[0].id);

            // Update preview from html file
            const htmlFile = parsedFiles.find(f => f.language === 'html');
            if (htmlFile) {
              // Inject CSS and JS into preview
              let previewHtml = htmlFile.content;
              const cssFile = parsedFiles.find(f => f.language === 'css');
              const jsFile = parsedFiles.find(f => f.language === 'js');
              if (cssFile) previewHtml = previewHtml.replace('</head>', `<style>${cssFile.content}</style></head>`);
              if (jsFile) previewHtml = previewHtml.replace('</body>', `<script>${jsFile.content}<\/script></body>`);
              setPreviewCode(CONSOLE_INTERCEPTOR + previewHtml);
              updateStep('s6', { status: 'active' });
            }

            if (parsedFiles.length >= 2) updateStep('s6', { status: 'done' });
            if (parsedFiles.length >= 3) { updateStep('s7', { status: 'active' }); }
          }

          // Fallback: single HTML file
          if (fileMatches.length === 0) {
            const htmlFenceIdx = fullText.indexOf('```html');
            const genericFenceIdx = fullText.indexOf('```');
            let currentCode = '';

            if (htmlFenceIdx !== -1) {
              const after = fullText.slice(htmlFenceIdx + 7);
              const closeIdx = after.indexOf('```');
              currentCode = closeIdx !== -1 ? after.slice(0, closeIdx) : after;
            } else if (genericFenceIdx !== -1) {
              const after = fullText.slice(genericFenceIdx + 3);
              const stripped = after.startsWith('html\n') ? after.slice(5) : after;
              const closeIdx = stripped.indexOf('```');
              currentCode = closeIdx !== -1 ? stripped.slice(0, closeIdx) : stripped;
            } else {
              const searchFrom = fullText.lastIndexOf('</step>');
              const region = searchFrom !== -1 ? fullText.slice(searchFrom + 7) : fullText;
              const rawIdx = Math.max(region.indexOf('<!DOCTYPE html>'), region.indexOf('<html'));
              if (rawIdx !== -1) currentCode = region.slice(rawIdx);
            }

            if (currentCode) {
              setPreviewCode(CONSOLE_INTERCEPTOR + currentCode);
              const singleFile: ProjectFile = { id: 'file-index', name: 'index.html', language: 'html', content: currentCode };
              setProjectFiles([singleFile]);
              setActiveFileId('file-index');
              updateStep('s5', { status: 'done' });
              updateStep('s6', { status: 'active' });
              const lineCount = currentCode.split('\n').length;
              if (lineCount > 80) { updateStep('s6', { status: 'done' }); updateStep('s7', { status: 'active' }); }
              if (lineCount > 120) updateStep('s7', { status: 'done' });
            }
          }
        }
      }

      // Finalize
      updateStep('s7', { status: 'done' });
      updateStep('s8', { status: 'active' });
      const elapsed = Math.round((Date.now() - buildStartRef.current) / 1000);
      setBuildTime(elapsed);

      const finalFiles = projectFiles.length > 0 ? projectFiles : [];
      if (finalFiles.length > 0 || previewCode) {
        pushHistory(finalFiles, userText.slice(0, 30));
        const lineCount = finalFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0);
        updateStep('s8', { status: 'done', detail: `${finalFiles.length} files, ${lineCount} lines, ${elapsed}s` });
        setMessages(prev => prev.map(m => m.id === buildMsgId
          ? { ...m, status: 'done', content: `✅ Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} in ${elapsed}s — ${lineCount} lines`, codeLines: lineCount }
          : m));
        addLog('system', `Done. ${finalFiles.length} files, ${lineCount} lines in ${elapsed}s.`);
        setActiveTab('preview');
        if (finalFiles.length > 0) setShowFileTree(true);
      } else {
        throw new Error('No code was extracted from the response.');
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

  // ── Main submit ────────────────────────────────────────────────────────────

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || phase !== 'idle') return;

    setInput('');
    setPendingUserText(text);
    setPhase('ai_questioning');

    setMessages(prev => [...prev, { id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }]);
    const thinkingId = `thinking-q-${Date.now()}`;
    setMessages(prev => [...prev, { id: thinkingId, role: 'agent', content: '', status: 'thinking', timestamp: new Date() }]);
    addLog('agent', `Analysing: "${text}"`);

    try {
      const questions = await generateAIQuestions(text);
      const qMsgId = `questions-${Date.now()}`;
      setMessages(prev => prev.filter(m => m.id !== thinkingId).concat({
        id: qMsgId, role: 'agent', content: '', status: 'questioning',
        timestamp: new Date(), questions,
      }));
      setPhase('questioning');
      addLog('system', `${questions.length} clarifying questions generated.`);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setPhase('idle');
      addLog('error', 'Failed to generate questions. Please try again.');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const deviceWidths = { desktop: '100%', tablet: '768px', mobile: '375px' };

  return (
    <>
      {/* Global styles */}
      <style>{`
        .arc-glass {
          background: rgba(255,255,255,0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .arc-btn-3d {
          background: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%);
          box-shadow: 0 1px 0 0 rgba(255,255,255,0.08) inset, 0 -1px 0 0 rgba(0,0,0,0.4) inset, 0 2px 8px rgba(0,0,0,0.3);
          transition: all 0.15s ease;
        }
        .arc-btn-3d:hover {
          background: linear-gradient(180deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.05) 100%);
          box-shadow: 0 1px 0 0 rgba(255,255,255,0.12) inset, 0 -1px 0 0 rgba(0,0,0,0.4) inset, 0 4px 12px rgba(0,0,0,0.35);
          transform: translateY(-1px);
        }
        .arc-btn-3d:active { transform: translateY(0px); box-shadow: 0 1px 0 0 rgba(255,255,255,0.06) inset, 0 -1px 0 0 rgba(0,0,0,0.5) inset, 0 1px 4px rgba(0,0,0,0.3); }
        .arc-btn-3d-active {
          background: linear-gradient(180deg, rgba(139,92,246,0.25) 0%, rgba(109,40,217,0.15) 100%);
          box-shadow: 0 1px 0 0 rgba(139,92,246,0.3) inset, 0 -1px 0 0 rgba(0,0,0,0.4) inset, 0 2px 12px rgba(139,92,246,0.25);
        }
        .arc-btn-3d-primary {
          background: linear-gradient(180deg, rgba(139,92,246,0.9) 0%, rgba(109,40,217,0.85) 100%);
          box-shadow: 0 1px 0 0 rgba(255,255,255,0.2) inset, 0 -1px 0 0 rgba(0,0,0,0.5) inset, 0 4px 20px rgba(139,92,246,0.4), 0 0 0 1px rgba(139,92,246,0.3);
          transition: all 0.15s ease;
        }
        .arc-btn-3d-primary:hover {
          box-shadow: 0 1px 0 0 rgba(255,255,255,0.25) inset, 0 -1px 0 0 rgba(0,0,0,0.5) inset, 0 6px 24px rgba(139,92,246,0.5), 0 0 0 1px rgba(139,92,246,0.4);
          transform: translateY(-1px);
        }
        .arc-input-glass {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 0 0 1px rgba(0,0,0,0.5) inset, 0 8px 32px rgba(0,0,0,0.3);
        }
        .arc-input-glass:focus-within {
          border-color: rgba(139,92,246,0.4);
          box-shadow: 0 0 0 1px rgba(0,0,0,0.5) inset, 0 8px 32px rgba(0,0,0,0.3), 0 0 0 3px rgba(139,92,246,0.12);
        }
        .arc-glow { box-shadow: 0 0 60px rgba(139,92,246,0.15), 0 0 120px rgba(139,92,246,0.07); }
        .arc-scrollbar::-webkit-scrollbar { width: 4px; }
        .arc-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .arc-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        @keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        .arc-scanline { animation: scan 8s linear infinite; }
      `}</style>

      <div className="flex h-screen bg-[#060608] overflow-hidden text-white">
        {/* Sidebar overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setSidebarOpen(false)}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
              <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
                transition={{ type: 'spring', damping: 28, stiffness: 280 }}
                className="fixed left-0 top-0 bottom-0 w-64 z-50 arc-glass border-r border-white/[0.08] shadow-2xl">
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
                className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.96, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -20 }}
                className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-md z-50 arc-glass border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
                  <Search className="w-4 h-4 text-gray-500" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search messages, commands…"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 outline-none"
                  />
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-gray-600">ESC</kbd>
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
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] transition-colors text-left">
                        <cmd.icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-300 flex-1">{cmd.label}</span>
                        {cmd.shortcut && <kbd className="text-[10px] text-gray-600">{cmd.shortcut}</kbd>}
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
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl arc-glass border border-white/10 text-sm text-white shadow-xl">
              <Check className="w-4 h-4 text-emerald-400" /> Link copied to clipboard
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main layout */}
        <div className="flex flex-col flex-1 min-w-0 h-full">
          {/* Top bar */}
          <div className="h-12 shrink-0 border-b border-white/[0.06] flex items-center px-3 gap-2 bg-black/40 backdrop-blur-xl">
            <button onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg arc-btn-3d text-gray-400 hover:text-white">
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-bold text-sm text-white tracking-tight">Arc</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30">AI</span>
            </div>

            {/* Status */}
            <div className="flex items-center gap-1.5 ml-1">
              <div className={cn('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="text-[10px] text-gray-600 font-mono hidden sm:block">{isOnline ? 'online' : 'offline'}</span>
            </div>

            {isStreaming && tokenCount > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-violet-400 font-mono ml-2">
                <Activity className="w-3 h-3 animate-pulse" />
                {tokenCount.toLocaleString()} tokens
              </div>
            )}

            {buildTime && !isStreaming && (
              <div className="flex items-center gap-1 text-[10px] text-gray-600 font-mono ml-2">
                <Clock className="w-3 h-3" />
                {buildTime}s
              </div>
            )}

            <div className="flex-1" />

            <div className="flex items-center gap-1.5">
              <button onClick={() => setSearchOpen(true)}
                className="flex items-center gap-1.5 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg arc-btn-3d hover:text-gray-300">
                <Search className="w-3.5 h-3.5" />
                <span className="hidden sm:block">Search</span>
                <kbd className="text-[10px] text-gray-700 hidden sm:block">⌘K</kbd>
              </button>
              {history.length > 1 && (
                <>
                  <button onClick={handleUndo} className="p-1.5 rounded-lg arc-btn-3d text-gray-500 hover:text-gray-300">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleRedo} className="p-1.5 rounded-lg arc-btn-3d text-gray-500 hover:text-gray-300">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {(previewCode || projectFiles.length > 0) && (
                <>
                  <button onClick={handleDownload}
                    className="flex items-center gap-1.5 text-xs text-gray-400 px-2.5 py-1.5 rounded-lg arc-btn-3d hover:text-white">
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:block">Download</span>
                  </button>
                  <button onClick={handleShare}
                    className="flex items-center gap-1.5 text-xs text-gray-400 px-2.5 py-1.5 rounded-lg arc-btn-3d hover:text-white">
                    <Share className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button onClick={handleNewProject}
                className="flex items-center gap-1.5 text-xs text-gray-400 px-2.5 py-1.5 rounded-lg arc-btn-3d hover:text-white">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:block">New</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-1 min-h-0 relative">
            {/* Chat panel */}
            <div className={cn(
              'flex flex-col h-full transition-all duration-500 border-r border-white/[0.06]',
              isMobile ? (mobileView === 'chat' ? 'w-full' : 'hidden') : messages.length > 0 ? 'w-[380px] shrink-0' : 'flex-1'
            )}>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto arc-scrollbar px-4 py-6 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-8 relative">
                    {/* Ambient glow */}
                    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4 relative">
                      <div className="relative">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-500/40 arc-glow">
                          <Zap className="w-8 h-8 text-white" />
                        </div>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                          className="absolute -inset-2 rounded-2xl border border-violet-500/20 border-dashed"
                        />
                      </div>
                      <div className="text-center">
                        <h1 className="text-2xl font-bold text-white tracking-tight">Arc AI Agent</h1>
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
                          className="text-left p-3 rounded-xl arc-btn-3d border border-white/[0.07] hover:border-violet-500/30 transition-all group">
                          <span className="text-base">{s.icon}</span>
                          <p className="text-xs text-gray-400 mt-1 group-hover:text-gray-300 transition-colors leading-snug">{s.text}</p>
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
                            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div className="arc-glass border border-white/[0.07] rounded-2xl px-4 py-3 text-sm text-gray-300">
                              {msg.content}
                            </div>
                          </motion.div>
                        )}
                        {msg.status === 'error' && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            className="flex items-start gap-2.5 max-w-sm">
                            <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                            </div>
                            <div className="arc-glass border border-red-500/20 rounded-2xl px-4 py-3 text-sm text-red-300">
                              {msg.content}
                            </div>
                          </motion.div>
                        )}
                        {msg.role === 'user' && (
                          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm arc-btn-3d-primary text-sm text-white">
                            {msg.content}
                          </motion.div>
                        )}
                        {msg.role === 'agent' && !msg.status && msg.content && (
                          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass border border-white/[0.07] text-sm text-gray-300">
                            {msg.content}
                          </motion.div>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 p-3 border-t border-white/[0.06]">
                <form onSubmit={handleSubmit}
                  className={cn('flex flex-col gap-2 rounded-2xl arc-input-glass p-3', isStreaming && 'opacity-80')}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isInputDisabled ? 'Arc is working…' : 'Describe what you want to build…'}
                    disabled={isInputDisabled}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-600 resize-none outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-600">
                      <Hash className="w-3 h-3" />
                      <span>Shift+Enter for newline</span>
                    </div>
                    {isStreaming ? (
                      <button type="button" onClick={handleStop}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors">
                        <X className="w-3.5 h-3.5" /> Stop
                      </button>
                    ) : (
                      <button type="submit" disabled={!input.trim() || isInputDisabled}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold disabled:opacity-30">
                        <Sparkles className="w-3.5 h-3.5" /> Build
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>

            {/* Preview panel */}
            {messages.length > 0 && (
              <div className={cn(
                'flex flex-col h-full bg-[#060608] transition-all duration-500',
                isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0' : 'hidden') : 'flex-1',
                isPreviewFullscreen ? 'fixed inset-0 z-50' : ''
              )}>
                {/* Tab bar */}
                <div className="h-11 shrink-0 border-b border-white/[0.06] flex items-center px-3 gap-1 bg-black/30 backdrop-blur-xl justify-between">
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
                            ? 'arc-btn-3d text-white'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
                        )}>
                        <tab.icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:block">{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Device switcher */}
                    {activeTab === 'preview' && (
                      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                        {(['desktop', 'tablet', 'mobile'] as const).map(d => (
                          <button key={d} onClick={() => setPreviewDevice(d)}
                            className={cn(
                              'px-2 py-1 rounded-md text-[10px] font-medium transition-all capitalize',
                              previewDevice === d ? 'bg-white/[0.1] text-white' : 'text-gray-600 hover:text-gray-400'
                            )}>
                            {d === 'desktop' ? '🖥' : d === 'tablet' ? '📱' : '📱'}
                            <span className="hidden sm:inline ml-1">{d}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* File tree toggle */}
                    {activeTab === 'code' && projectFiles.length > 0 && (
                      <button onClick={() => setShowFileTree(f => !f)}
                        className={cn('p-1.5 rounded-lg transition-colors text-xs', showFileTree ? 'arc-btn-3d text-white' : 'text-gray-500 hover:text-gray-300')}>
                        <PanelLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {history.length > 1 && (
                      <div className="flex items-center gap-1 text-[10px] text-gray-600 px-2 py-1 arc-glass border border-white/[0.06] rounded-lg font-mono">
                        <GitBranch className="w-3 h-3" />
                        v{historyIndex + 1}/{history.length}
                      </div>
                    )}
                    <button onClick={() => setIsPreviewFullscreen(f => !f)}
                      className="p-1.5 rounded-lg arc-btn-3d text-gray-500 hover:text-white">
                      {isPreviewFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Preview content */}
                <div className="flex flex-1 min-h-0">
                  {/* File tree sidebar */}
                  {activeTab === 'code' && showFileTree && projectFiles.length > 0 && (
                    <div className="w-44 shrink-0 border-r border-white/[0.06] bg-[#080808]">
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
                      <div className="w-full h-full flex flex-col items-center p-4 bg-[#060608]">
                        <div
                          className="bg-white rounded-xl overflow-hidden border border-white/[0.08] shadow-2xl transition-all duration-500 flex flex-col"
                          style={{
                            width: previewDevice === 'desktop' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px',
                            maxWidth: '100%',
                            height: '100%',
                          }}>
                          {/* Browser chrome */}
                          <div className="h-9 shrink-0 bg-[#1a1a1a] border-b border-white/[0.06] flex items-center px-3 gap-2">
                            <div className="flex gap-1.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                            </div>
                            <div className="mx-auto flex-1 max-w-xs h-5 bg-white/[0.06] rounded-md flex items-center justify-center text-[10px] text-gray-600 font-mono">
                              localhost:3000
                            </div>
                            {previewCode && (
                              <button
                                onClick={() => {
                                  const win = window.open('', '_blank');
                                  if (win) { win.document.write(previewCode); win.document.close(); }
                                }}
                                className="p-1 rounded hover:bg-white/10 text-gray-600 hover:text-gray-400 transition-colors">
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="relative flex-1 bg-white">
                            <AnimatePresence>
                              {isStreaming && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                  className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#060608]">
                                  <div className="relative">
                                    <motion.div
                                      animate={{ rotate: 360 }}
                                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                                      className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-500/40">
                                      <Zap className="w-6 h-6 text-white" />
                                    </motion.div>
                                  </div>
                                  <p className="text-sm font-medium text-gray-300 mt-4">Building your project…</p>
                                  <p className="text-xs text-gray-600 mt-1 font-mono">{tokenCount > 0 ? `${tokenCount.toLocaleString()} tokens` : 'Connecting…'}</p>
                                </motion.div>
                              )}
                            </AnimatePresence>
                            {previewCode
                              ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                              : !isStreaming && (
                                <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 bg-[#060608]">
                                  <Play className="w-8 h-8 opacity-20" />
                                  <span className="text-sm opacity-40">Preview will appear here</span>
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
                          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
                            <FileCode2 className="w-8 h-8 opacity-30" />
                            <span className="text-sm opacity-50">No files yet</span>
                            <button onClick={addFile}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl arc-btn-3d text-gray-400 text-xs">
                              <Plus className="w-3.5 h-3.5" /> Add file
                            </button>
                          </div>
                        ) : activeFile ? (
                          <CodeEditor
                            file={activeFile}
                            onChange={(content) => updateFileContent(activeFile.id, content)}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
                            <span className="text-sm">Select a file from the sidebar</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Console tab */}
                    {activeTab === 'console' && (
                      <div className="w-full h-full bg-[#080808] text-gray-300 font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        {consoleLogs.length === 0
                          ? <div className="text-gray-700 italic">No console output yet…</div>
                          : consoleLogs.map((log, i) => (
                            <div key={log.id} className={cn(
                              'flex gap-2 mb-1.5 leading-relaxed',
                              log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-400'
                            )}>
                              <span className="shrink-0 text-gray-700">{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                              <span className={cn('shrink-0 font-bold', log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-amber-500' : 'text-gray-700')}>
                                [{log.type.toUpperCase()}]
                              </span>
                              <span className="whitespace-pre-wrap break-words">{log.message}</span>
                            </div>
                          ))}
                        <div ref={consoleEndRef} />
                      </div>
                    )}

                    {/* Logs tab with terminal typing */}
                    {activeTab === 'logs' && (
                      <div className="w-full h-full bg-[#080808] font-mono text-[11px] p-4 overflow-auto arc-scrollbar">
                        <div className="mb-3 flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-violet-400" />
                          <span className="text-violet-400 font-semibold">Arc Terminal</span>
                        </div>
                        {logs.map((log, i) => (
                          <div key={log.id} className={cn(
                            'flex gap-2 mb-1.5 leading-relaxed',
                            log.type === 'system' ? 'text-emerald-400' : log.type === 'error' ? 'text-red-400' : log.type === 'info' ? 'text-blue-400' : 'text-gray-400'
                          )}>
                            <span className="shrink-0 text-gray-700">{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span className="shrink-0 text-gray-700">
                              {log.type === 'system' ? '[sys]' : log.type === 'error' ? '[err]' : log.type === 'info' ? '[inf]' : '[arc]'}
                            </span>
                            {/* Terminal typing for recent arc logs */}
                            {log.type === 'agent' && i >= logs.length - 3 ? (
                              <TerminalLine text={log.message} delay={(logs.length - 1 - i) * 0} />
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
          <div className="fixed bottom-0 left-0 right-0 h-14 border-t border-white/[0.06] flex bg-black/80 backdrop-blur-xl z-30">
            <button onClick={() => setMobileView('chat')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'chat' ? 'text-white' : 'text-gray-600')}>
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button onClick={() => setMobileView('preview')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                mobileView === 'preview' ? 'text-white' : 'text-gray-600')}>
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>
        )}
      </div>
    </>
  );
}
