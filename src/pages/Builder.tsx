import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Play, Terminal, FileCode2,
  MessageSquare, RotateCcw, ChevronUp,
  Maximize2, Minimize2, Zap, Code2, Eye,
  Check, X, ChevronRight, ChevronDown, Cpu, Layers,
  CircleDot, Menu, Folder, Share, Rocket, Sparkles,
  ArrowRight, Brain, Wand2, Activity
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageStatus = 'thinking' | 'questioning' | 'planning' | 'awaiting_approval' | 'building' | 'streaming' | 'generating_code' | 'done' | 'error';

type ClarifyOption = {
  id: string;
  label: string;
  description?: string;
};

type ClarifyQuestion = {
  id: string;
  question: string;
  type: 'single' | 'multi';
  options: ClarifyOption[];
  selectedIds: string[];
};

type PlanStep = {
  id: string;
  title: string;
  description: string;
};

type AgentStep = {
  id: string;
  label: string;
  detail?: string;
  status: 'pending' | 'active' | 'done';
  expanded?: boolean;
};

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  status?: MessageStatus;
  codeLines?: number;
  timestamp: Date;
  questions?: ClarifyQuestion[];
  questionsDone?: boolean;
  plan?: PlanStep[];
  planApproved?: boolean;
  planLabel?: string;
  agentSteps?: AgentStep[];
};

type LogEntry = {
  id: string;
  type: 'agent' | 'system' | 'error';
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
  code: string;
  label: string;
  timestamp: Date;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://zenoai-uflq.onrender.com';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const SUGGESTIONS = [
  'Build a modern SaaS pricing page',
  'Create a personal portfolio',
  'Design a dashboard with charts',
  'Build a landing page for an app',
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

// ─── AI Helpers (Anthropic API) ───────────────────────────────────────────────

async function callAnthropicJSON(prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await response.json();
  return data.content?.map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join('') ?? '';
}

async function generateAIQuestions(userText: string): Promise<ClarifyQuestion[]> {
  const prompt = `You are Arc, an expert AI frontend developer agent. A user wants to build this:

"${userText}"

Generate 2-3 sharp, highly specific clarifying questions that will help you build exactly what they need. Each question must be directly tied to their specific request — not generic boilerplate.

Return ONLY valid JSON (no markdown, no explanation, no backticks):
[
  {
    "id": "q1",
    "question": "...",
    "type": "single",
    "options": [
      { "id": "q1_a", "label": "...", "description": "..." },
      { "id": "q1_b", "label": "...", "description": "..." }
    ]
  }
]

Rules:
- type is "single" for mutually exclusive choices, "multi" for additive selections
- 2-4 options per question
- Options must be concrete and specific, not vague like "Modern" or "Classic"
- Questions should uncover design decisions that change the implementation significantly`;

  try {
    const raw = await callAnthropicJSON(prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed.map((q: ClarifyQuestion) => ({ ...q, selectedIds: [] }));
  } catch {
    // Fallback if AI call fails
    return [
      {
        id: 'q1',
        question: 'What visual style best matches your vision?',
        type: 'single',
        options: [
          { id: 'q1_a', label: 'Minimal & clean', description: 'Lots of whitespace, subtle details' },
          { id: 'q1_b', label: 'Bold & expressive', description: 'Strong colors, impactful typography' },
          { id: 'q1_c', label: 'Dark & premium', description: 'Dark theme with glassy accents' },
        ],
        selectedIds: [],
      },
    ];
  }
}

async function generateAIPlan(userText: string, answers: Record<string, string[]>): Promise<{ label: string; steps: PlanStep[] }> {
  const answerSummary = Object.entries(answers)
    .map(([q, opts]) => `- ${q}: ${opts.join(', ')}`)
    .join('\n');

  const prompt = `You are Arc, an expert AI frontend developer. A user wants to build:

"${userText}"

They answered these clarifying questions:
${answerSummary}

Create a specific, implementation-focused build plan for THIS exact project. Steps should reflect the real work: what components, what features, what design choices.

Return ONLY valid JSON (no markdown, no explanation, no backticks):
{
  "label": "Short title for what you're building (max 40 chars)",
  "steps": [
    { "id": "p1", "title": "...", "description": "..." },
    { "id": "p2", "title": "...", "description": "..." },
    { "id": "p3", "title": "...", "description": "..." },
    { "id": "p4", "title": "...", "description": "..." }
  ]
}

Rules:
- 4-5 steps maximum
- Each step title is specific (e.g. "Build hero with animated gradient headline" not "Create hero section")
- Each description mentions specific tech/components relevant to their request
- Ordered by implementation priority`;

  try {
    const raw = await callAnthropicJSON(prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return { label: parsed.label, steps: parsed.steps };
  } catch {
    return {
      label: userText.slice(0, 40),
      steps: [
        { id: 'p1', title: 'Set up design system & core layout', description: 'Typography, color tokens, responsive grid' },
        { id: 'p2', title: 'Build primary pages & components', description: 'Hero, features, navigation, and interactive elements' },
        { id: 'p3', title: 'Add animations & micro-interactions', description: 'Scroll effects, hover states, transitions' },
        { id: 'p4', title: 'Polish & finalize', description: 'Accessibility, performance, and cross-browser testing' },
      ],
    };
  }
}

// ─── SSE / NDJSON Parser ──────────────────────────────────────────────────────

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

// ─── Session Fetcher ──────────────────────────────────────────────────────────

async function createSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/v1/session/new`, { method: 'POST' });
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  const data = await res.json();
  return data.session_id ?? data.sessionId ?? data.id ?? data.uuid ?? `fallback-${Date.now()}`;
}

// ─── ClarifyCard ─────────────────────────────────────────────────────────────

function ClarifyCard({
  msg,
  onAnswer,
  onSubmit,
}: {
  msg: Message;
  onAnswer: (msgId: string, qId: string, optId: string) => void;
  onSubmit: (msgId: string) => void;
}) {
  const allAnswered = msg.questions?.every(q => q.selectedIds.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
      className="w-full max-w-lg space-y-3"
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center">
          <Brain className="w-3.5 h-3.5 text-violet-500" />
        </div>
        <span className="text-xs font-semibold text-violet-500 tracking-widest uppercase">
          Arc is thinking about your project
        </span>
      </div>

      {msg.questions?.map((q, qi) => (
        <motion.div
          key={q.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: qi * 0.1, type: 'spring', damping: 25, stiffness: 250 }}
          className="rounded-2xl overflow-hidden bg-white/60 dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.07] backdrop-blur-xl"
        >
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{q.question}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {q.type === 'multi' ? 'Choose all that apply' : 'Pick one'}
            </p>
          </div>
          <div className="px-4 pb-4 grid gap-2">
            {q.options.map((opt) => {
              const selected = q.selectedIds.includes(opt.id);
              return (
                <motion.button
                  key={opt.id}
                  onClick={() => onAnswer(msg.id, q.id, opt.id)}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 flex items-start gap-3',
                    selected
                      ? 'bg-gray-900 dark:bg-white border-transparent'
                      : 'bg-gray-50/80 dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06] hover:border-black/20 dark:hover:border-white/20'
                  )}
                >
                  <div className={cn(
                    'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                    selected
                      ? 'border-white dark:border-gray-900'
                      : 'border-gray-300 dark:border-gray-600'
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-gray-900" />}
                  </div>
                  <div>
                    <p className={cn(
                      'text-sm font-medium leading-snug',
                      selected ? 'text-white dark:text-gray-900' : 'text-gray-800 dark:text-gray-200'
                    )}>{opt.label}</p>
                    {opt.description && (
                      <p className={cn(
                        'text-xs mt-0.5',
                        selected ? 'text-gray-300 dark:text-gray-500' : 'text-gray-400'
                      )}>{opt.description}</p>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      ))}

      <AnimatePresence>
        {allAnswered && !msg.questionsDone && (
          <motion.button
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onClick={() => onSubmit(msg.id)}
            className="w-full py-3.5 rounded-2xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
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

function PlanCard({
  msg,
  onApprove,
  onReject,
}: {
  msg: Message;
  onApprove: (msgId: string) => void;
  onReject: (msgId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 20, stiffness: 200 }}
      className="w-full max-w-lg"
    >
      <div className="rounded-2xl overflow-hidden bg-white/60 dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.07] backdrop-blur-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-black/[0.05] dark:border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Layers className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {msg.planLabel || 'Implementation Plan'}
              </p>
              <p className="text-xs text-gray-400">AI-generated for your project</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="p-4 space-y-2">
          {msg.plan?.map((step, i) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, type: 'spring', damping: 25, stiffness: 250 }}
              className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-50/80 dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]"
            >
              <div className="mt-0.5 w-5 h-5 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-white dark:text-gray-900">{i + 1}</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{step.title}</p>
                {step.description && (
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{step.description}</p>
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Actions */}
        {!msg.planApproved ? (
          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={() => onApprove(msg.id)}
              className="flex-1 py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Rocket className="w-4 h-4" />
              Start building
            </button>
            <button
              onClick={() => onReject(msg.id)}
              className="w-11 h-11 rounded-xl border border-black/[0.08] dark:border-white/[0.08] flex items-center justify-center text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.05] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-black/[0.05] dark:border-white/[0.05] flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-white" />
            </div>
            <span className="text-xs font-medium text-emerald-500">Plan approved — building now</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── AgentStepsCard ───────────────────────────────────────────────────────────

function AgentStepsCard({ steps }: { steps: AgentStep[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = (doneCount / steps.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg rounded-2xl overflow-hidden bg-white/60 dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.07] backdrop-blur-xl"
    >
      {/* Header with progress */}
      <div className="px-5 py-4 border-b border-black/[0.05] dark:border-white/[0.05]">
        <div className="flex items-center gap-3 mb-3">
          <motion.div
            animate={{ rotate: activeStep ? 360 : 0 }}
            transition={{ duration: 2, repeat: activeStep ? Infinity : 0, ease: 'linear' }}
          >
            <Activity className="w-4 h-4 text-amber-500" />
          </motion.div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 truncate">
            {activeStep ? activeStep.label : steps.at(-1)?.label ?? 'Processing…'}
          </span>
          <span className="text-xs text-gray-400 tabular-nums">{doneCount}/{steps.length}</span>
        </div>
        {/* Progress bar */}
        <div className="h-1 w-full bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gray-900 dark:bg-white rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', damping: 30, stiffness: 200 }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
        {steps.map((step, i) => (
          <div key={step.id}>
            <button
              onClick={() => step.detail ? setExpandedId(expandedId === step.id ? null : step.id) : undefined}
              className={cn(
                'w-full flex items-center gap-3 px-5 py-3 text-left transition-colors',
                step.detail ? 'hover:bg-gray-50/80 dark:hover:bg-white/[0.03]' : 'cursor-default'
              )}
            >
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300',
                step.status === 'done' ? 'bg-emerald-500' :
                step.status === 'active' ? 'bg-amber-400' :
                'border border-gray-200 dark:border-white/10'
              )}>
                {step.status === 'done' && <Check className="w-3 h-3 text-white" />}
                {step.status === 'active' && (
                  <motion.div
                    animate={{ scale: [1, 1.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-white"
                  />
                )}
                {step.status === 'pending' && (
                  <span className="text-[9px] font-bold text-gray-300 dark:text-white/20">{i + 1}</span>
                )}
              </div>
              <span className={cn(
                'text-sm flex-1 transition-colors',
                step.status === 'done' ? 'text-gray-400 dark:text-gray-600 line-through' :
                step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' :
                'text-gray-400 dark:text-gray-600'
              )}>{step.label}</span>
              {step.detail && (
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 text-gray-300 dark:text-gray-600 transition-transform duration-200',
                  expandedId === step.id && 'rotate-180'
                )} />
              )}
            </button>
            <AnimatePresence>
              {expandedId === step.id && step.detail && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-3 pl-[52px] text-xs text-gray-400 font-mono leading-relaxed bg-gray-50/60 dark:bg-white/[0.02]">
                    {step.detail}
                  </div>
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
    <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-white/60 dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.07] w-fit">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"
          animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── TabButton ────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 h-full border-b-2 px-1 text-xs font-medium transition-all whitespace-nowrap',
        active
          ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
          : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentPage, setCurrentPage] = useState('Builder');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs'>('preview');
  const { theme } = useTheme();

  const [previewCode, setPreviewCode] = useState('');
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

  // Phase: 'idle' | 'ai_questioning' | 'questioning' | 'ai_planning' | 'planning' | 'building'
  const [phase, setPhase] = useState<'idle' | 'ai_questioning' | 'questioning' | 'ai_planning' | 'planning' | 'building'>('idle');
  const [pendingUserText, setPendingUserText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);

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

  const pushHistory = useCallback((code: string, label: string) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, { id: Date.now().toString(), code, label, timestamp: new Date() }];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const prev = history[historyIndex - 1];
    setHistoryIndex(i => i - 1);
    setPreviewCode(CONSOLE_INTERCEPTOR + prev.code);
    addLog('system', `Reverted to: ${prev.label}`);
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
    setLogs([{ id: Date.now().toString(), type: 'system', message: 'Started new project.', timestamp: new Date() }]);
    setConsoleLogs([]);
    setSessionId(null);
    setIsStreaming(false);
    setHistory([]);
    setHistoryIndex(-1);
    setCurrentPage('Builder');
    setPhase('idle');
    setPendingUserText('');
    if (isMobile) setMobileView('chat');
  };

  // ── Handle Answer ──────────────────────────────────────────────────────────

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

  // ── Submit Answers → AI generates plan ────────────────────────────────────

  const handleQuestionsSubmit = async (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, questionsDone: true, status: 'planning' } : m));
    setPhase('ai_planning');

    // Gather answers for context
    const questionMsg = messages.find(m => m.id === msgId);
    const answers: Record<string, string[]> = {};
    questionMsg?.questions?.forEach(q => {
      const selectedLabels = q.options
        .filter(o => q.selectedIds.includes(o.id))
        .map(o => o.label);
      answers[q.question] = selectedLabels;
    });

    // Show thinking indicator
    const thinkingId = `thinking-plan-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: thinkingId,
      role: 'agent',
      content: '',
      status: 'thinking',
      timestamp: new Date(),
    }]);

    addLog('agent', 'Generating context-aware build plan…');

    try {
      const { label, steps } = await generateAIPlan(pendingUserText, answers);

      // Replace thinking with plan
      const planMsgId = `plan-${Date.now()}`;
      setMessages(prev => prev
        .filter(m => m.id !== thinkingId)
        .concat({
          id: planMsgId,
          role: 'agent',
          content: 'Here\'s your custom build plan:',
          status: 'awaiting_approval',
          timestamp: new Date(),
          planLabel: label,
          plan: steps,
        })
      );
      setPhase('planning');
      addLog('system', `Plan ready: ${label}`);
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setPhase('idle');
      addLog('error', 'Failed to generate plan. Please try again.');
    }
  };

  // ── Approve plan → start building ─────────────────────────────────────────

  const handleApprovePlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, planApproved: true } : m));
    setPhase('building');
    startBuild();
  };

  const handleRejectPlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId
      ? { ...m, status: 'error', content: 'Plan rejected. Describe what you\'d like differently.' }
      : m
    ));
    setPhase('idle');
  };

  // ── Start the actual build ─────────────────────────────────────────────────

  const startBuild = async () => {
    const userText = pendingUserText;
    setIsStreaming(true);
    if (isMobile) setMobileView('preview');
    setActiveTab('logs');

    const buildMsgId = `build-${Date.now()}`;
    const initialSteps: AgentStep[] = [
      { id: 's1', label: 'Initialising session', status: 'pending' },
      { id: 's2', label: 'Connecting to Arc engine', status: 'pending' },
      { id: 's3', label: 'Analysing design requirements', status: 'pending' },
      { id: 's4', label: 'Generating HTML structure', status: 'pending' },
      { id: 's5', label: 'Applying styles & layout', status: 'pending' },
      { id: 's6', label: 'Adding interactivity', status: 'pending' },
      { id: 's7', label: 'Finalising & optimising', status: 'pending' },
    ];

    setMessages(prev => [...prev, {
      id: buildMsgId,
      role: 'agent',
      content: '',
      status: 'building',
      timestamp: new Date(),
      agentSteps: initialSteps,
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
          addLog('error', 'Session fallback.');
        }
      }
      updateStep('s1', { status: 'done', detail: `session_id: ${sid?.slice(0, 8)}…` });
      updateStep('s2', { status: 'active' });

      const systemPrompt = `You are Arc, an expert AI frontend developer. The user wants to build a web UI.
User request: "${userText}"

You MUST output your response in two parts:
1. Step-by-step thought process using exactly: <step>Step description here</step>
2. Final code in a single \`\`\`html block.

Code requirements:
- Use Tailwind CSS via CDN.
- Include any JS in <script> tags.
- Modern, premium, minimal design (Vercel/Linear/Stripe quality).
- Fully responsive.
- DO NOT include any markdown outside of <step> tags and the \`\`\`html block.`;

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
      let currentCode = '';
      const seenSteps = new Set<string>();
      let codeStarted = false;

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

          const stepMatches = [...fullText.matchAll(/<step>([\s\S]*?)<\/step>/g)];
          for (const m of stepMatches) {
            const stepMsg = m[1].trim();
            if (stepMsg && !seenSteps.has(stepMsg)) {
              seenSteps.add(stepMsg);
              addLog('agent', stepMsg);
            }
          }

          if (!codeStarted) {
            if (seenSteps.size >= 1) updateStep('s3', { status: 'done' });
            if (seenSteps.size >= 2) updateStep('s4', { status: 'active' });
          }

          const htmlFenceIdx = fullText.indexOf('```html');
          const genericFenceIdx = fullText.indexOf('```');

          if (htmlFenceIdx !== -1) {
            if (!codeStarted) {
              codeStarted = true;
              updateStep('s4', { status: 'done' });
              updateStep('s5', { status: 'active' });
            }
            const after = fullText.slice(htmlFenceIdx + 7);
            const closeIdx = after.indexOf('```');
            currentCode = closeIdx !== -1 ? after.slice(0, closeIdx) : after;
          } else if (genericFenceIdx !== -1) {
            if (!codeStarted) {
              codeStarted = true;
              updateStep('s4', { status: 'done' });
              updateStep('s5', { status: 'active' });
            }
            const after = fullText.slice(genericFenceIdx + 3);
            const stripped = after.startsWith('html\n') ? after.slice(5) : after;
            const closeIdx = stripped.indexOf('```');
            currentCode = closeIdx !== -1 ? stripped.slice(0, closeIdx) : stripped;
          } else {
            const searchFrom = fullText.lastIndexOf('</step>');
            const region = searchFrom !== -1 ? fullText.slice(searchFrom + 7) : fullText;
            const doctypeIdx = region.indexOf('<!DOCTYPE html>');
            const htmlTagIdx = region.indexOf('<html');
            const rawIdx = doctypeIdx !== -1 ? doctypeIdx : htmlTagIdx !== -1 ? htmlTagIdx : -1;
            if (rawIdx !== -1) {
              if (!codeStarted) {
                codeStarted = true;
                updateStep('s4', { status: 'done' });
                updateStep('s5', { status: 'active' });
              }
              currentCode = region.slice(rawIdx);
            }
          }

          if (currentCode) {
            const lines = currentCode.split('\n').length;
            setPreviewCode(CONSOLE_INTERCEPTOR + currentCode);
            if (lines > 50) updateStep('s5', { status: 'done', detail: `${lines} lines` });
            if (lines > 80) updateStep('s6', { status: 'active' });
            if (lines > 120) { updateStep('s6', { status: 'done' }); updateStep('s7', { status: 'active' }); }
          }
        }
      }

      // Finalize
      updateStep('s7', { status: 'done' });
      const finalLineCount = currentCode.split('\n').length;

      if (currentCode) {
        pushHistory(currentCode, userText.slice(0, 30));
        setMessages(prev => prev.map(m => m.id === buildMsgId
          ? { ...m, status: 'done', content: `Built successfully — ${finalLineCount} lines of code`, codeLines: finalLineCount }
          : m
        ));
        addLog('system', `Done. ${finalLineCount} lines generated.`);
      } else {
        throw new Error('No code was extracted from the response.');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.map(m => m.id === buildMsgId
          ? { ...m, status: 'error', content: 'Build stopped by user.' }
          : m
        ));
        return;
      }
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', errMsg);
      setMessages(prev => prev.map(m => m.id === buildMsgId
        ? { ...m, status: 'error', content: `Build failed: ${errMsg}` }
        : m
      ));
    } finally {
      setIsStreaming(false);
      setPhase('idle');
    }
  };

  // ── Handle Submit (main) ───────────────────────────────────────────────────

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || phase !== 'idle') return;

    setInput('');
    setPendingUserText(text);
    setPhase('ai_questioning');

    // Add user message
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }]);

    // Show thinking while AI generates questions
    const thinkingId = `thinking-q-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: thinkingId,
      role: 'agent',
      content: '',
      status: 'thinking',
      timestamp: new Date(),
    }]);

    addLog('agent', `Analysing: "${text}"`);

    try {
      const questions = await generateAIQuestions(text);

      const qMsgId = `questions-${Date.now()}`;
      setMessages(prev => prev
        .filter(m => m.id !== thinkingId)
        .concat({
          id: qMsgId,
          role: 'agent',
          content: '',
          status: 'questioning',
          timestamp: new Date(),
          questions,
        })
      );
      setPhase('questioning');
      addLog('system', `${questions.length} clarifying questions generated.`);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setPhase('idle');
      addLog('error', 'Failed to generate questions. Please try again.');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const isInputDisabled = phase !== 'idle';

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#080808] overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Top bar */}
        <div className="h-14 shrink-0 border-b border-black/[0.05] dark:border-white/[0.05] flex items-center px-4 gap-3 bg-white/80 dark:bg-black/40 backdrop-blur-xl">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-500 transition-colors lg:hidden"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gray-900 dark:bg-white flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white dark:text-gray-900" />
            </div>
            <span className="font-semibold text-sm text-gray-900 dark:text-white">Arc</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-500 border border-violet-500/20">
              AI
            </span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            {history.length > 1 && (
              <button
                onClick={handleUndo}
                className="flex items-center gap-1.5 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Undo
              </button>
            )}
            <button
              onClick={handleNewProject}
              className="flex items-center gap-1.5 text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] transition-colors"
            >
              <Folder className="w-3.5 h-3.5" />
              New
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 relative">
          {/* Chat panel */}
          <div className={cn(
            'flex flex-col h-full transition-all duration-500',
            isMobile ? (mobileView === 'chat' ? 'w-full' : 'hidden') : (messages.length > 0 ? 'w-[420px] shrink-0' : 'flex-1')
          )}>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                /* ── Empty state ── */
                <div className="flex flex-col items-center justify-center h-full px-6 pb-24">
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 20 }}
                    className="text-center max-w-sm"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-gray-900 dark:bg-white flex items-center justify-center mx-auto mb-5 shadow-lg">
                      <Sparkles className="w-7 h-7 text-white dark:text-gray-900" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">
                      What are we building?
                    </h1>
                    <p className="text-sm text-gray-400 leading-relaxed mb-8">
                      Describe your idea and Arc will ask the right questions, create a custom plan, then build it live.
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {SUGGESTIONS.map((s, i) => (
                        <motion.button
                          key={s}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.07 + 0.2 }}
                          onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                          className="text-left px-4 py-3 rounded-xl border border-black/[0.06] dark:border-white/[0.07] bg-white/60 dark:bg-white/[0.02] hover:bg-white dark:hover:bg-white/[0.05] text-sm text-gray-600 dark:text-gray-400 transition-all hover:border-black/20 dark:hover:border-white/20 group flex items-center justify-between"
                        >
                          <span>{s}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" />
                        </motion.button>
                      ))}
                    </div>
                  </motion.div>
                </div>
              ) : (
                /* ── Message list ── */
                <div className="p-4 space-y-4">
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                        className={cn(
                          'flex',
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        {/* User bubble */}
                        {msg.role === 'user' && (
                          <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-sm bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm leading-relaxed">
                            {msg.content}
                          </div>
                        )}

                        {/* Agent content */}
                        {msg.role === 'agent' && (
                          <div className="w-full max-w-lg space-y-3">
                            {/* Thinking */}
                            {msg.status === 'thinking' && <ThinkingDots />}

                            {/* Questions */}
                            {msg.status === 'questioning' && msg.questions && !msg.questionsDone && (
                              <ClarifyCard
                                msg={msg}
                                onAnswer={handleAnswer}
                                onSubmit={handleQuestionsSubmit}
                              />
                            )}
                            {msg.questionsDone && (
                              <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                Questions answered — generating plan
                              </div>
                            )}

                            {/* Plan */}
                            {(msg.status === 'awaiting_approval' || msg.planApproved) && msg.plan && (
                              <PlanCard
                                msg={msg}
                                onApprove={handleApprovePlan}
                                onReject={handleRejectPlan}
                              />
                            )}

                            {/* Agent steps */}
                            {msg.agentSteps && msg.status !== 'done' && msg.status !== 'error' && (
                              <AgentStepsCard steps={msg.agentSteps} />
                            )}

                            {/* Done */}
                            {msg.status === 'done' && msg.content && (
                              <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/20">
                                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{msg.content}</p>
                                  {msg.codeLines && (
                                    <p className="text-xs text-emerald-500/60 mt-0.5">{msg.codeLines} lines generated</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Error */}
                            {msg.status === 'error' && (
                              <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-red-500/[0.06] border border-red-500/20">
                                <X className="w-4 h-4 text-red-500 shrink-0" />
                                <p className="text-sm text-red-500">{msg.content}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-black/[0.05] dark:border-white/[0.05] bg-white/80 dark:bg-black/30 backdrop-blur-xl">
              <form onSubmit={handleSubmit} className="relative">
                <div className={cn(
                  'flex items-end gap-2 px-4 py-3 rounded-2xl border transition-all duration-200 bg-white dark:bg-white/[0.04]',
                  isInputDisabled
                    ? 'border-black/[0.05] dark:border-white/[0.05] opacity-60'
                    : 'border-black/[0.1] dark:border-white/[0.1] hover:border-black/20 dark:hover:border-white/20 focus-within:border-black/30 dark:focus-within:border-white/30'
                )}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    placeholder={isInputDisabled ? 'Arc is working…' : 'Describe what you want to build…'}
                    disabled={isInputDisabled}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none outline-none leading-relaxed"
                  />
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      className="w-8 h-8 mb-0.5 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 hover:bg-red-600 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!input.trim() || isInputDisabled}
                      className="w-8 h-8 mb-0.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center shrink-0 disabled:opacity-30 hover:opacity-80 transition-opacity"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-center mt-2 text-[10px] text-gray-400 dark:text-gray-600">
                  Arc uses AI to understand your project · Shift+Enter for new line
                </p>
              </form>
            </div>
          </div>

          {/* Preview panel */}
          {messages.length > 0 && (
            <div className={cn(
              'flex flex-col h-full bg-gray-50/50 dark:bg-[#050505] transition-all duration-500 border-l border-black/[0.05] dark:border-white/[0.05]',
              isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0' : 'hidden') : 'flex-1',
              isPreviewFullscreen ? 'fixed inset-0 z-50' : ''
            )}>
              {/* Tab bar */}
              <div className="h-14 shrink-0 border-b border-black/[0.05] dark:border-white/[0.05] flex items-center px-4 gap-5 bg-white/80 dark:bg-black/30 backdrop-blur-xl justify-between">
                <div className="flex gap-5 h-full">
                  <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={Eye} label="Preview" />
                  <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={Terminal} label={`Console${consoleLogs.length ? ` (${consoleLogs.length})` : ''}`} />
                  <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={FileCode2} label={`Logs${logs.length > 1 ? ` (${logs.length})` : ''}`} />
                </div>
                <div className="flex items-center gap-2">
                  {history.length > 1 && (
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 px-2 py-1 bg-gray-50 dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg font-mono">
                      <Code2 className="w-3 h-3" />
                      v{historyIndex + 1}/{history.length}
                    </div>
                  )}
                  <button
                    onClick={() => setIsPreviewFullscreen(f => !f)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 transition-colors"
                  >
                    {isPreviewFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex-1 relative p-4">
                <div className="w-full h-full bg-white rounded-2xl overflow-hidden border border-black/[0.08] dark:border-white/[0.08] shadow-xl flex flex-col">
                  {/* Browser chrome */}
                  <div className="h-10 shrink-0 bg-gray-100/80 dark:bg-[#111] border-b border-black/[0.06] dark:border-white/[0.06] flex items-center px-4 gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
                    </div>
                    <div className="mx-auto w-48 h-6 bg-white/80 dark:bg-white/[0.05] rounded-lg border border-black/[0.06] dark:border-white/[0.06] flex items-center justify-center text-[10px] text-gray-400 font-mono">
                      localhost:3000
                    </div>
                  </div>

                  {/* Preview */}
                  {activeTab === 'preview' && (
                    <div className="relative w-full flex-1 bg-white">
                      <AnimatePresence>
                        {isStreaming && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-black/90 backdrop-blur-xl"
                          >
                            <motion.div
                              animate={{
                                scale: [1, 1.15, 1],
                                rotate: [0, 180, 360],
                              }}
                              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                              className="w-10 h-10 rounded-2xl bg-gray-900 dark:bg-white flex items-center justify-center mb-4"
                            >
                              <Zap className="w-5 h-5 text-white dark:text-gray-900" />
                            </motion.div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Synthesising…</p>
                            <p className="text-xs text-gray-400 mt-1">Building your UI live</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {previewCode
                        ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                        : (
                          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-300 dark:text-gray-700">
                            <Play className="w-10 h-10 opacity-40" />
                            <span className="text-sm">Preview will appear here</span>
                          </div>
                        )
                      }
                    </div>
                  )}

                  {/* Console */}
                  {activeTab === 'console' && (
                    <div className="w-full flex-1 bg-[#0d0d0d] text-gray-300 font-mono text-[11px] p-4 overflow-auto">
                      {consoleLogs.length === 0
                        ? <div className="text-gray-600 italic">No console output yet…</div>
                        : consoleLogs.map(log => (
                          <div key={log.id} className={cn(
                            'flex gap-2 mb-2 leading-relaxed',
                            log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-400'
                          )}>
                            <span className="shrink-0 text-gray-600">{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span className="whitespace-pre-wrap break-words">{log.message}</span>
                          </div>
                        ))
                      }
                      <div ref={consoleEndRef} />
                    </div>
                  )}

                  {/* Logs */}
                  {activeTab === 'logs' && (
                    <div className="w-full flex-1 bg-[#0d0d0d] text-gray-300 font-mono text-[11px] p-4 overflow-auto">
                      {logs.map(log => (
                        <div key={log.id} className={cn(
                          'flex gap-2 mb-2 leading-relaxed',
                          log.type === 'system' ? 'text-emerald-400' : log.type === 'error' ? 'text-red-400' : 'text-gray-400'
                        )}>
                          <span className="shrink-0 text-gray-600">{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          <span className="shrink-0 text-gray-600">{log.type === 'system' ? '[sys]' : log.type === 'error' ? '[err]' : '[arc]'}</span>
                          <span className="whitespace-pre-wrap break-words">{log.message}</span>
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

        {/* Mobile bottom nav */}
        {isMobile && messages.length > 0 && (
          <div className="h-14 shrink-0 border-t border-black/[0.05] dark:border-white/[0.05] flex bg-white/80 dark:bg-black/40 backdrop-blur-xl z-20">
            <button
              onClick={() => setMobileView('chat')}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-xs font-medium',
                mobileView === 'chat' ? 'text-gray-900 dark:text-white' : 'text-gray-400'
              )}
            >
              <MessageSquare className="w-4.5 h-4.5" />
              Chat
            </button>
            <button
              onClick={() => setMobileView('preview')}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-xs font-medium',
                mobileView === 'preview' ? 'text-gray-900 dark:text-white' : 'text-gray-400'
              )}
            >
              <Play className="w-4.5 h-4.5" />
              Preview
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
