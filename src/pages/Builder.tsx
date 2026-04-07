import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Play, Terminal, FileCode2,
  MessageSquare, RotateCcw, ChevronUp,
  Maximize2, Minimize2, Zap, Code2, Eye,
  Check, X, ChevronRight, ChevronDown, Cpu, Layers,
  CircleDot, Menu, Folder, Share, Rocket
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
  // Clarification flow
  questions?: ClarifyQuestion[];
  questionsDone?: boolean;
  // Plan flow
  plan?: PlanStep[];
  planApproved?: boolean;
  planLabel?: string;
  // Live agent steps
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClarifyCard({ msg, onAnswer }: { msg: Message; onAnswer: (msgId: string, qId: string, optId: string) => void; onSubmit: (msgId: string) => void }) {
  const allAnswered = msg.questions?.every(q => q.selectedIds.length > 0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg space-y-4"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 px-1">
        <CircleDot className="w-3 h-3" />
        Questions for you
      </div>
      {msg.questions?.map((q, qi) => (
        <motion.div
          key={q.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: qi * 0.08 }}
          className="rounded-2xl border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111] overflow-hidden shadow-sm"
        >
          <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1e1e1e]">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{q.question}</p>
            <p className="text-xs text-gray-400 mt-0.5">{q.type === 'multi' ? 'Select all that apply' : 'Select one answer'}</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-[#1e1e1e]">
            {q.options.map((opt) => {
              const selected = q.selectedIds.includes(opt.id);
              return (
                <motion.button
                  key={opt.id}
                  onClick={() => onAnswer(msg.id, q.id, opt.id)}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'w-full text-left px-5 py-3.5 flex items-start gap-3 transition-colors',
                    selected
                      ? 'bg-gray-900 dark:bg-white'
                      : 'hover:bg-gray-50 dark:hover:bg-[#1a1a1a]'
                  )}
                >
                  <div className={cn(
                    'mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                    selected
                      ? 'border-white dark:border-gray-900 bg-white dark:bg-gray-900'
                      : 'border-gray-300 dark:border-[#444]'
                  )}>
                    {selected && <div className="w-1.5 h-1.5 rounded-full bg-gray-900 dark:bg-white" />}
                  </div>
                  <div>
                    <p className={cn('text-sm font-medium', selected ? 'text-white dark:text-gray-900' : 'text-gray-800 dark:text-gray-200')}>{opt.label}</p>
                    {opt.description && <p className={cn('text-xs mt-0.5', selected ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400')}>{opt.description}</p>}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      ))}
      {allAnswered && !msg.questionsDone && (
        <motion.button
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Check className="w-4 h-4" />
          Continue
        </motion.button>
      )}
    </motion.div>
  );
}

function PlanCard({ msg, onApprove, onReject }: { msg: Message; onApprove: (msgId: string) => void; onReject: (msgId: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg"
    >
      <div className="rounded-2xl border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111] overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-[#1e1e1e] flex items-center gap-2">
          <Layers className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{msg.planLabel || 'Implementation Plan'}</span>
        </div>
        <div className="divide-y divide-gray-100 dark:divide-[#1e1e1e]">
          {msg.plan?.map((step, i) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07 }}
              className="px-5 py-4 flex items-start gap-3"
            >
              <div className="mt-0.5 w-5 h-5 rounded-full border border-gray-200 dark:border-[#333] flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-gray-400">{i + 1}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{step.title}</p>
                {step.description && <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>}
              </div>
            </motion.div>
          ))}
        </div>
        {!msg.planApproved && (
          <div className="px-5 py-4 border-t border-gray-100 dark:border-[#1e1e1e] flex gap-3">
            <button
              onClick={() => onApprove(msg.id)}
              className="flex-1 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Check className="w-4 h-4" />
              Approve Plan
            </button>
            <button
              onClick={() => onReject(msg.id)}
              className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#333] text-gray-500 text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {msg.planApproved && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-[#1e1e1e] flex items-center gap-2 text-xs text-green-500 font-medium">
            <Check className="w-3.5 h-3.5" />
            Plan approved — building now
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AgentStepsCard({ steps }: { steps: AgentStep[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#111] overflow-hidden shadow-sm"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-gray-100 dark:border-[#1e1e1e] flex items-center gap-3">
        <motion.div
          animate={{ rotate: activeStep ? 360 : 0 }}
          transition={{ duration: 2, repeat: activeStep ? Infinity : 0, ease: 'linear' }}
        >
          <Cpu className="w-4 h-4 text-gray-400" />
        </motion.div>
        <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1">
          {activeStep ? activeStep.label : steps.at(-1)?.label ?? 'Processing…'}
        </span>
        <span className="text-xs text-gray-400">{doneCount}/{steps.length}</span>
      </div>

      {/* Steps */}
      <div className="divide-y divide-gray-100 dark:divide-[#1e1e1e]">
        {steps.map((step, i) => (
          <div key={step.id}>
            <button
              onClick={() => step.detail ? setExpandedId(expandedId === step.id ? null : step.id) : undefined}
              className={cn(
                'w-full flex items-center gap-3 px-5 py-3 text-left transition-colors',
                step.detail ? 'hover:bg-gray-50 dark:hover:bg-[#1a1a1a]' : 'cursor-default'
              )}
            >
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all',
                step.status === 'done' ? 'bg-green-500' :
                step.status === 'active' ? 'bg-amber-400' :
                'border border-gray-200 dark:border-[#333]'
              )}>
                {step.status === 'done' && <Check className="w-3 h-3 text-white" />}
                {step.status === 'active' && (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-white"
                  />
                )}
                {step.status === 'pending' && <span className="text-[9px] font-bold text-gray-300">{i + 1}</span>}
              </div>
              <span className={cn(
                'text-sm flex-1',
                step.status === 'done' ? 'text-gray-400 line-through' :
                step.status === 'active' ? 'text-gray-900 dark:text-white font-medium' :
                'text-gray-400'
              )}>{step.label}</span>
              {step.detail && (
                <ChevronDown className={cn('w-3.5 h-3.5 text-gray-300 transition-transform', expandedId === step.id && 'rotate-180')} />
              )}
            </button>
            <AnimatePresence>
              {expandedId === step.id && step.detail && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-3 pl-13 text-xs text-gray-400 font-mono leading-relaxed bg-gray-50 dark:bg-[#0d0d0d] border-t border-gray-100 dark:border-[#1e1e1e]">
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

// ─── Component ───────────────────────────────────────────────────────────────

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

  // Phase tracking: 'idle' | 'questioning' | 'planning' | 'building'
  const [phase, setPhase] = useState<'idle' | 'questioning' | 'planning' | 'building'>('idle');
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

  // ── Answer clarifying question ─────────────────────────────────────────────

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

  // When user submits answers → proceed to plan phase
  const handleQuestionsSubmit = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, questionsDone: true, status: 'planning' } : m));
    setPhase('planning');
    // Generate the plan
    generatePlan(msgId);
  };

  // Handle clicking Continue button inside ClarifyCard
  const handleClarifyButtonClick = (msgId: string) => {
    handleQuestionsSubmit(msgId);
  };

  // ── Generate plan (calls AI) ───────────────────────────────────────────────

  const generatePlan = async (questionMsgId: string) => {
    const questionMsg = messages.find(m => m.id === questionMsgId) || 
      // need to read from the latest state
      null;

    // Build context from user text + answers
    const userText = pendingUserText;

    // Add planning message
    const planMsgId = `plan-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: planMsgId,
      role: 'agent',
      content: 'Here\'s what I\'d recommend building:',
      status: 'awaiting_approval',
      timestamp: new Date(),
      planLabel: userText.slice(0, 40),
      plan: [
        { id: 'p1', title: 'Set up design system & core layout', description: 'Typography, color tokens, responsive grid' },
        { id: 'p2', title: 'Build primary pages & components', description: 'Hero, features, navigation, and interactive elements' },
        { id: 'p3', title: 'Add animations & micro-interactions', description: 'Scroll effects, hover states, transitions' },
        { id: 'p4', title: 'Polish & finalize', description: 'Accessibility, performance, and cross-browser testing' },
      ],
    }]);
  };

  // ── Approve plan → start building ─────────────────────────────────────────

  const handleApprovePlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, planApproved: true } : m));
    setPhase('building');
    startBuild();
  };

  const handleRejectPlan = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status: 'error', content: 'Plan rejected. Please describe what you\'d like differently.' } : m));
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
      // Step 1
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

          // Extract <step> tags → update agent steps detail
          const stepMatches = [...fullText.matchAll(/<step>([\s\S]*?)<\/step>/g)];
          for (const m of stepMatches) {
            const stepMsg = m[1].trim();
            if (stepMsg && !seenSteps.has(stepMsg)) {
              seenSteps.add(stepMsg);
              addLog('agent', stepMsg);
            }
          }

          // Update step indicators based on content progress
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
            // progress step indicators
            if (lines > 50) updateStep('s5', { status: 'done', detail: `${lines} lines` });
            if (lines > 80) updateStep('s6', { status: 'active' });
            if (lines > 120) { updateStep('s6', { status: 'done' }); updateStep('s7', { status: 'active' }); }

            setMessages(prev => prev.map(m =>
              m.id === buildMsgId ? { ...m, codeLines: lines, status: 'generating_code' } : m
            ));
          }
        }
      }

      if (carryover.trim()) {
        const lastChunk = extractChunkText(carryover);
        if (lastChunk) fullText += lastChunk;
      }

      // Mark all remaining steps done
      ['s3','s4','s5','s6','s7'].forEach(id => updateStep(id, { status: 'done' }));

      setMessages(prev => prev.map(m =>
        m.id === buildMsgId ? { ...m, content: 'Build complete.', status: 'done' } : m
      ));

      if (currentCode) {
        pushHistory(currentCode, userText.slice(0, 40));
        addLog('system', `Build complete — ${currentCode.split('\n').length} lines.`);
      }
      setActiveTab('preview');

    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setMessages(prev => prev.map(m =>
        m.id === buildMsgId ? { ...m, content: `Error: ${err.message || 'Something went wrong.'}`, status: 'error' } : m
      ));
      addLog('error', `Build failed: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Main submit (entry point) ──────────────────────────────────────────────

  const handleSubmit = async (e: FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userText = input.trim();
    setInput('');
    setPendingUserText(userText);

    // Add user message
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
      status: 'done',
      timestamp: new Date(),
    }]);

    // Phase: ask clarifying questions
    setPhase('questioning');

    const questionMsgId = `q-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: questionMsgId,
      role: 'agent',
      content: 'Let me ask you a few quick questions to build exactly what you need.',
      status: 'questioning',
      timestamp: new Date(),
      questions: [
        {
          id: 'q1',
          question: 'What type of project is this?',
          type: 'single',
          options: [
            { id: 'saas', label: 'SaaS / Web App', description: 'Dashboard, tool, or subscription product' },
            { id: 'landing', label: 'Landing Page', description: 'Marketing page or product showcase' },
            { id: 'portfolio', label: 'Portfolio / Personal', description: 'Personal brand or creative showcase' },
            { id: 'ecomm', label: 'E-Commerce', description: 'Store, product listings, or checkout' },
            { id: 'other', label: 'Other', description: 'Something else entirely' },
          ],
          selectedIds: [],
        },
        {
          id: 'q2',
          question: 'What\'s your preferred visual style?',
          type: 'single',
          options: [
            { id: 'minimal', label: 'Clean & Minimal', description: 'Lots of whitespace, subtle details' },
            { id: 'bold', label: 'Bold & Expressive', description: 'Strong typography, vivid colors' },
            { id: 'dark', label: 'Dark / Cinematic', description: 'Dark backgrounds, glows, premium feel' },
            { id: 'playful', label: 'Playful / Fun', description: 'Rounded corners, bright accents' },
          ],
          selectedIds: [],
        },
      ],
      questionsDone: false,
    }]);
  };

  // ─── Watch for all questions answered to enable Continue ─────────────────

  const latestQuestionMsg = messages.findLast(m => m.questions && !m.questionsDone);
  const allAnswered = latestQuestionMsg?.questions?.every(q => q.selectedIds.length > 0);

  // ── Current code ref for toolbar ──────────────────────────────────────────
  const currentCode = history[historyIndex]?.code ?? '';

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen w-full flex bg-white dark:bg-[#0A0A0A] overflow-hidden text-gray-900 dark:text-white transition-colors duration-200">

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobile && sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
              className="fixed inset-y-0 left-0 w-[280px] z-50 bg-white dark:bg-[#0A0A0A] shadow-2xl"
            >
              <Sidebar isMobileDrawer onClose={() => setSidebarOpen(false)} onNewProject={handleNewProject} onNavigate={setCurrentPage} activeItem={currentPage === 'Builder' ? 'New Project' : currentPage} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      {!isMobile && (
        <div className="shrink-0 z-20">
          <Sidebar onNewProject={handleNewProject} onNavigate={setCurrentPage} activeItem={currentPage === 'Builder' ? 'New Project' : currentPage} />
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 relative">

        {/* Mobile Header */}
        {isMobile && (
          <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center justify-between px-4 bg-white dark:bg-[#0A0A0A] z-10">
            <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-400">
              <Menu className="w-5 h-5" />
            </button>
            <div className="font-medium text-sm">Arc</div>
            <div className="w-9" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 flex overflow-hidden relative">
          {currentPage !== 'Builder' ? (
            <div className="flex-1 overflow-y-auto p-8 bg-white dark:bg-[#0A0A0A]">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto">
                <h2 className="text-3xl font-semibold tracking-tight mb-8">{currentPage}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="group relative h-48 rounded-3xl bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#222] p-6 flex flex-col justify-between hover:border-gray-300 dark:hover:border-[#444] transition-all cursor-pointer overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#222] shadow-sm border border-gray-100 dark:border-[#333] flex items-center justify-center">
                        <Folder className="w-5 h-5 text-gray-400" />
                      </div>
                      <div>
                        <div className="h-5 w-2/3 bg-gray-200 dark:bg-[#333] rounded-md mb-2" />
                        <div className="h-3 w-1/3 bg-gray-100 dark:bg-[#222] rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          ) : (
            <>
              {/* ── Chat Panel ───────────────────────────────────────────── */}
              <div className={cn(
                'flex flex-col h-full border-r border-gray-200 dark:border-[#222] bg-white dark:bg-[#0A0A0A] z-10 transition-all duration-500 ease-in-out',
                isMobile
                  ? (mobileView === 'chat' ? 'w-full absolute inset-0' : 'hidden')
                  : (messages.length > 0 ? 'w-[420px] xl:w-[500px] shrink-0' : 'w-full')
              )}>
                {messages.length === 0 ? (
                  /* ── Hero ──────────────────────────────────────────────── */
                  <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-blue-500/10 to-purple-500/10 blur-3xl rounded-full pointer-events-none" />
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl w-full text-center space-y-8 relative z-10">
                      <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
                        What do you want to build?
                      </h1>
                      <p className="text-gray-500 dark:text-gray-400 text-lg">Describe an interface and Arc builds it in seconds.</p>
                      <form onSubmit={handleSubmit} className="relative flex items-center w-full bg-white/80 dark:bg-[#111]/80 backdrop-blur-xl border border-gray-200 dark:border-[#333] rounded-3xl p-2 shadow-2xl focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                        <textarea
                          ref={textareaRef}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e); }}
                          placeholder="Describe your app…"
                          className="w-full bg-transparent border-none resize-none py-4 px-6 text-lg text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-400"
                          rows={1}
                        />
                        <button type="submit" disabled={!input.trim()} className="p-4 rounded-2xl bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50 transition-transform hover:scale-105 active:scale-95 shrink-0">
                          <Send className="w-5 h-5" />
                        </button>
                      </form>
                      <div className="flex flex-wrap justify-center gap-3 pt-4">
                        {SUGGESTIONS.map(s => (
                          <button key={s} onClick={() => setInput(s)} className="px-4 py-2 rounded-full bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#222] transition-colors">
                            {s}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  </div>
                ) : (
                  <>
                    {/* Desktop Top Bar */}
                    {!isMobile && (
                      <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center justify-between px-4 bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-md">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-sm">Untitled Project</span>
                          <span className={cn('px-2 py-0.5 rounded-full border text-xs flex items-center gap-1.5',
                            isStreaming
                              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400'
                              : 'bg-gray-100 dark:bg-[#1A1A1A] border-gray-200 dark:border-[#333] text-gray-500 dark:text-gray-400'
                          )}>
                            <div className={cn('w-1.5 h-1.5 rounded-full', isStreaming ? 'bg-amber-500 animate-pulse' : 'bg-green-500')} />
                            {isStreaming ? 'Building…' : phase === 'questioning' ? 'Clarifying' : phase === 'planning' ? 'Planning' : 'Ready'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {historyIndex > 0 && (
                            <button onClick={handleUndo} title="Undo" className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 transition-colors">
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {history.length > 1 && (
                            <div className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1 bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-md">
                              <Code2 className="w-3 h-3" />
                              v{historyIndex + 1}/{history.length}
                            </div>
                          )}
                          <button className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 transition-colors">
                            <Share className="w-4 h-4" />
                          </button>
                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white dark:bg-white dark:text-black font-medium text-sm hover:opacity-90 transition-opacity">
                            <Rocket className="w-4 h-4" />
                            Deploy
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                      {messages.map(msg => (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={msg.id}
                          className={cn('flex gap-3', msg.role === 'user' ? 'ml-auto flex-row-reverse max-w-[85%]' : 'max-w-full')}
                        >
                          {/* Avatar */}
                          <div className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                            msg.role === 'user' ? 'bg-gray-100 dark:bg-[#222]' : 'bg-gray-900 text-white dark:bg-white dark:text-black'
                          )}>
                            {msg.role === 'user'
                              ? <div className="w-4 h-4 rounded-full bg-gray-400" />
                              : <Zap className="w-4 h-4 text-white dark:text-black" />
                            }
                          </div>

                          <div className={cn('flex flex-col gap-3 flex-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
                            {/* Main bubble */}
                            {msg.content && (
                              <div className={cn(
                                'px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
                                msg.role === 'user'
                                  ? 'bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] text-gray-900 dark:text-white rounded-tr-sm'
                                  : msg.status === 'error'
                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50'
                                    : 'bg-transparent text-gray-700 dark:text-gray-200'
                              )}>
                                {msg.content}
                              </div>
                            )}

                            {/* Clarifying questions */}
                            {msg.questions && (
                              <ClarifyCard
                                msg={msg}
                                onAnswer={handleAnswer}
                                onSubmit={handleClarifyButtonClick}
                              />
                            )}

                            {/* Continue button */}
                            {msg.questions && !msg.questionsDone && msg.questions.every(q => q.selectedIds.length > 0) && (
                              <motion.button
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                onClick={() => handleClarifyButtonClick(msg.id)}
                                className="w-full max-w-lg py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                              >
                                <Check className="w-4 h-4" />
                                Continue
                              </motion.button>
                            )}

                            {/* Plan card */}
                            {msg.plan && (
                              <PlanCard msg={msg} onApprove={handleApprovePlan} onReject={handleRejectPlan} />
                            )}

                            {/* Agent steps */}
                            {msg.agentSteps && msg.agentSteps.length > 0 && (
                              <AgentStepsCard steps={msg.agentSteps} />
                            )}

                            {/* Status for non-special states */}
                            {msg.status && !['done', 'error', 'questioning', 'awaiting_approval', 'planning'].includes(msg.status) && !msg.agentSteps && (
                              <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                {msg.status === 'thinking' ? 'Thinking…'
                                  : msg.status === 'building' ? 'Starting build…'
                                  : msg.status === 'streaming' ? 'Writing…'
                                  : msg.status === 'generating_code' ? `Generating${msg.codeLines ? ` (${msg.codeLines} lines)` : ''}…`
                                  : 'Working…'}
                              </div>
                            )}

                            {/* Done state — no copy/download */}
                            {msg.status === 'done' && msg.role === 'agent' && msg.agentSteps && (
                              <div className="flex items-center gap-2 text-xs text-green-500 px-1">
                                <Check className="w-3.5 h-3.5" />
                                Build complete · {msg.codeLines ?? 0} lines generated
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-4 bg-white dark:bg-[#0A0A0A]">
                      <form
                        onSubmit={handleSubmit}
                        className="relative flex items-end gap-2 bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-xl p-2 focus-within:border-gray-400 dark:focus-within:border-[#555] transition-all"
                      >
                        <textarea
                          ref={textareaRef}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e); }}
                          placeholder={isStreaming ? 'Arc is building…' : 'Ask Arc to modify or build something…'}
                          disabled={isStreaming || phase === 'questioning' || phase === 'planning'}
                          className="w-full bg-transparent border-none resize-none max-h-40 min-h-[44px] py-3 px-3 text-sm text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-500 disabled:opacity-50"
                          rows={1}
                        />
                        {isStreaming ? (
                          <button type="button" onClick={handleStop} className="p-2.5 mb-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0">
                            <div className="w-4 h-4 bg-white rounded-sm" />
                          </button>
                        ) : (
                          <button type="submit" disabled={!input.trim() || phase === 'questioning' || phase === 'planning'} className="p-2.5 mb-1 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-40 transition-colors shrink-0">
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                      </form>
                      <div className="text-center mt-2 text-[10px] text-gray-400 dark:text-gray-600">
                        Arc may make mistakes. Always review generated code. · Enter to send
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Preview Panel ─────────────────────────────────────────── */}
              {messages.length > 0 && (
                <div className={cn(
                  'flex flex-col h-full bg-gray-50 dark:bg-[#050505] transition-all duration-500',
                  isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0' : 'hidden') : 'flex-1',
                  isPreviewFullscreen ? 'fixed inset-0 z-50' : ''
                )}>
                  {/* Tab bar */}
                  <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center px-4 gap-6 bg-white dark:bg-[#0A0A0A] justify-between">
                    <div className="flex gap-6 h-full">
                      <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={Eye} label="Preview" />
                      <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={Terminal} label={`Console${consoleLogs.length ? ` (${consoleLogs.length})` : ''}`} />
                      <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={FileCode2} label={`Logs${logs.length > 1 ? ` (${logs.length})` : ''}`} />
                    </div>
                    <div className="flex items-center gap-2">
                      {history.length > 1 && (
                        <div className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1 bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-md">
                          <Code2 className="w-3 h-3" />
                          v{historyIndex + 1}/{history.length}
                        </div>
                      )}
                      <button onClick={() => setIsPreviewFullscreen(f => !f)} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 transition-colors">
                        {isPreviewFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 relative p-4">
                    <div className="w-full h-full bg-white dark:bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-[#222] shadow-xl relative flex flex-col">
                      {/* Browser chrome */}
                      <div className="h-10 shrink-0 bg-[#f5f5f5] border-b border-gray-200 flex items-center px-4 gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-400" />
                          <div className="w-3 h-3 rounded-full bg-amber-400" />
                          <div className="w-3 h-3 rounded-full bg-green-400" />
                        </div>
                        <div className="mx-auto w-1/2 h-6 bg-white rounded-md border border-gray-200 flex items-center justify-center text-[10px] text-gray-400 font-mono">
                          localhost:3000
                        </div>
                      </div>

                      {/* Preview */}
                      {activeTab === 'preview' && (
                        <div className="relative w-full flex-1 bg-white">
                          {isStreaming && (
                            <motion.div
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-xl"
                            >
                              <div className="relative w-32 h-32 flex items-center justify-center">
                                <motion.div
                                  animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 180, 270, 360], borderRadius: ['20%', '50%', '30%', '50%', '20%'] }}
                                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                                  className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-purple-500 opacity-20 blur-2xl"
                                />
                                <Loader2 className="w-8 h-8 animate-spin text-gray-700" />
                              </div>
                              <p className="mt-6 text-sm text-gray-500 font-mono">Synthesising…</p>
                            </motion.div>
                          )}
                          {previewCode
                            ? <iframe srcDoc={previewCode} className="w-full h-full border-none" title="Live Preview" sandbox="allow-scripts allow-same-origin" />
                            : (
                              <div className="flex items-center justify-center h-full text-gray-400 text-sm flex-col gap-2">
                                <Play className="w-8 h-8 opacity-30" />
                                <span>Preview will appear here</span>
                              </div>
                            )
                          }
                        </div>
                      )}

                      {/* Console */}
                      {activeTab === 'console' && (
                        <div className="w-full flex-1 bg-gray-900 text-gray-300 font-mono text-xs p-4 overflow-auto">
                          {consoleLogs.length === 0
                            ? <div className="text-gray-500 italic">No console output yet…</div>
                            : consoleLogs.map(log => (
                              <div key={log.id} className={cn('flex gap-2 mb-2', log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-300')}>
                                <span className="shrink-0 text-gray-500">[{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                                <span className="shrink-0">&gt;</span>
                                <span className="whitespace-pre-wrap break-words">{log.message}</span>
                              </div>
                            ))
                          }
                          <div ref={consoleEndRef} />
                        </div>
                      )}

                      {/* Logs */}
                      {activeTab === 'logs' && (
                        <div className="w-full flex-1 bg-gray-900 text-gray-300 font-mono text-xs p-4 overflow-auto">
                          {logs.map(log => (
                            <div key={log.id} className={cn('flex gap-2 mb-2', log.type === 'system' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : 'text-gray-400')}>
                              <span className="shrink-0 text-gray-600">[{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                              <span className="shrink-0">{log.type === 'system' ? '[System]' : log.type === 'error' ? '[Error]' : '[Agent]'}</span>
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
            </>
          )}
        </div>

        {/* Mobile Bottom Nav */}
        {isMobile && messages.length > 0 && (
          <div className="h-14 shrink-0 border-t border-gray-200 dark:border-[#222] flex bg-white dark:bg-[#0A0A0A] z-20">
            <button
              onClick={() => setMobileView('chat')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 transition-colors', mobileView === 'chat' ? 'text-gray-900 dark:text-white' : 'text-gray-500')}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-[10px] font-medium">Chat</span>
            </button>
            <button
              onClick={() => setMobileView('preview')}
              className={cn('flex-1 flex flex-col items-center justify-center gap-1 transition-colors', mobileView === 'preview' ? 'text-gray-900 dark:text-white' : 'text-gray-500')}
            >
              <Play className="w-5 h-5" />
              <span className="text-[10px] font-medium">Preview</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

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
        'flex items-center gap-2 h-full border-b-2 px-1 text-sm font-medium transition-colors whitespace-nowrap',
        active
          ? 'border-gray-900 text-gray-900 dark:border-white dark:text-white'
          : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
