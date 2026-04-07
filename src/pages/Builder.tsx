import { useState, useRef, useEffect, useCallback, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Play, Terminal, FileCode2, Share, Rocket, Menu,
  MessageSquare, Folder, Copy, Check, RotateCcw, Download, ChevronUp,
  Maximize2, Minimize2, Zap, Code2, Eye
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageStatus = 'thinking' | 'building' | 'streaming' | 'generating_code' | 'done' | 'error';

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  status?: MessageStatus;
  codeLines?: number;
  timestamp: Date;
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

// ─── Bulletproof SSE / NDJSON Parser ─────────────────────────────────────────
//
// The backend sends newline-delimited JSON like:
//   {"content":"Hello"}
//   {"content":"!"}
//   data: {"content":" How"}
//   data: [DONE]
//
// TCP chunks can split these arbitrarily, so we maintain a carryover buffer.
// We try full JSON.parse first; if that fails we fall back to a targeted regex
// that extracts the "content" value — this handles partial/malformed wrappers.
//
function extractChunkText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[DONE]') return '';

  // Strip SSE prefix
  const stripped = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
  if (stripped === '[DONE]') return '';

  // 1) Try clean JSON.parse
  try {
    const parsed = JSON.parse(stripped);
    return (
      parsed.content ??
      parsed.text ??
      parsed.message ??
      parsed.chunk ??
      parsed.response ??
      parsed.delta?.content ??
      ''
    );
  } catch {
    // 2) Regex fallback: extract value of known content keys
    const match = stripped.match(/"(?:content|text|message|chunk|response|delta)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) {
      try {
        return JSON.parse('"' + match[1] + '"');
      } catch {
        return match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentPage, setCurrentPage] = useState('Builder');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs'>('preview');
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [previewCode, setPreviewCode] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 'init', type: 'system', message: 'Arc dev server ready.', timestamp: new Date() },
  ]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  // Version history for undo
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Mobile
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

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

  // Auto-grow textarea
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
      const entry: HistoryEntry = { id: Date.now().toString(), code, label, timestamp: new Date() };
      return [...trimmed, entry];
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

  const handleCopyCode = async (msgId: string, code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleDownload = (code: string, filename = 'arc-output.html') => {
    const blob = new Blob([code], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
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
    if (isMobile) setMobileView('chat');
  };

  // ── Main submit ────────────────────────────────────────────────────────────

  const handleSubmit = async (e: FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userText = input.trim();
    const userMsgId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: userMsgId, role: 'user', content: userText, status: 'done', timestamp: new Date()
    }]);
    setInput('');
    setIsStreaming(true);
    if (isMobile) setMobileView('preview');
    setActiveTab('logs');

    const agentMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: agentMsgId, role: 'agent', content: 'Thinking...', status: 'thinking', timestamp: new Date()
    }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      // ── 1. Ensure session ──────────────────────────────────────────────────
      let sid = sessionId;
      if (!sid) {
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId ? { ...m, content: 'Starting session...', status: 'building' } : m
        ));
        try {
          sid = await createSession();
          setSessionId(sid);
          addLog('system', `Session created: ${sid.slice(0, 8)}…`);
        } catch (err) {
          sid = `fallback-${Date.now()}`;
          addLog('error', 'Session creation failed, using fallback.');
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === agentMsgId ? { ...m, content: 'Connecting to Arc…', status: 'building' } : m
      ));

      // ── 2. Build system prompt ─────────────────────────────────────────────
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

      // ── 3. Stream ──────────────────────────────────────────────────────────
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
      let carryover = '';   // incomplete line from previous chunk
      let fullText = '';
      let currentCode = '';
      let seenSteps = new Set<string>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode and prepend any carryover from last iteration
        const raw = carryover + decoder.decode(value, { stream: true });

        // Split on newlines — last element may be incomplete
        const lines = raw.split('\n');
        carryover = lines.pop() ?? '';  // save incomplete tail for next iteration

        for (const line of lines) {
          const chunkText = extractChunkText(line);
          if (!chunkText) continue;

          fullText += chunkText;

          // ── Extract <step> tags ──────────────────────────────────────────
          const stepMatches = [...fullText.matchAll(/<step>([\s\S]*?)<\/step>/g)];
          for (const m of stepMatches) {
            const stepMsg = m[1].trim();
            if (stepMsg && !seenSteps.has(stepMsg)) {
              seenSteps.add(stepMsg);
              addLog('agent', stepMsg);
            }
          }
          const latestStep = stepMatches.at(-1)?.[1]?.trim() ?? '';

          // ── Extract code block ───────────────────────────────────────────
          let status: MessageStatus = 'streaming';
          let codeLines = 0;

          const htmlFenceIdx = fullText.indexOf('```html');
          const genericFenceIdx = fullText.indexOf('```');

          if (htmlFenceIdx !== -1) {
            status = 'generating_code';
            const after = fullText.slice(htmlFenceIdx + 7);
            const closeIdx = after.indexOf('```');
            currentCode = closeIdx !== -1 ? after.slice(0, closeIdx) : after;
          } else if (genericFenceIdx !== -1) {
            status = 'generating_code';
            const after = fullText.slice(genericFenceIdx + 3);
            const stripped = after.startsWith('html\n') ? after.slice(5) : after;
            const closeIdx = stripped.indexOf('```');
            currentCode = closeIdx !== -1 ? stripped.slice(0, closeIdx) : stripped;
          } else {
            // Bare HTML fallback (no fences)
            const searchFrom = fullText.lastIndexOf('</step>');
            const region = searchFrom !== -1 ? fullText.slice(searchFrom + 7) : fullText;
            const doctypeIdx = region.indexOf('<!DOCTYPE html>');
            const htmlTagIdx = region.indexOf('<html');
            const rawIdx = doctypeIdx !== -1 ? doctypeIdx : htmlTagIdx !== -1 ? htmlTagIdx : -1;
            if (rawIdx !== -1) {
              status = 'generating_code';
              currentCode = region.slice(rawIdx);
            }
          }

          if (currentCode) {
            codeLines = currentCode.split('\n').length;
            setPreviewCode(CONSOLE_INTERCEPTOR + currentCode);
          }

          // ── Clean display text ───────────────────────────────────────────
          let displayText = (htmlFenceIdx !== -1
            ? fullText.slice(0, htmlFenceIdx)
            : genericFenceIdx !== -1
              ? fullText.slice(0, genericFenceIdx)
              : currentCode
                ? fullText.slice(0, fullText.length - currentCode.length)
                : fullText
          )
            .replace(/<step>[\s\S]*?<\/step>/g, '')
            .replace(/<step>[\s\S]*$/g, '')
            .trim();

          if (!displayText && latestStep) displayText = latestStep + '…';

          setMessages(prev => prev.map(m =>
            m.id === agentMsgId
              ? { ...m, content: displayText || 'Working…', status, codeLines }
              : m
          ));
        }
      }

      // ── Flush carryover (last line with no trailing newline) ───────────────
      if (carryover.trim()) {
        const lastChunk = extractChunkText(carryover);
        if (lastChunk) fullText += lastChunk;
      }

      // ── Finalise ───────────────────────────────────────────────────────────
      const finalDisplay = fullText
        .split('```')[0]
        .replace(/<step>[\s\S]*?<\/step>/g, '')
        .trim();

      setMessages(prev => prev.map(m =>
        m.id === agentMsgId
          ? { ...m, content: finalDisplay || 'Done! Preview updated.', status: 'done' }
          : m
      ));

      if (currentCode) {
        pushHistory(currentCode, userText.slice(0, 40));
        addLog('system', `Build complete — ${currentCode.split('\n').length} lines generated.`);
      } else {
        addLog('system', 'Response complete.');
      }
      setActiveTab('preview');

    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled — already handled

      console.error('[Arc] Stream error:', err);
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId
          ? { ...m, content: `Error: ${err.message || 'Something went wrong.'}`, status: 'error' }
          : m
      ));
      addLog('error', `Build failed: ${err.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  // ── Current code ref for toolbar actions ──────────────────────────────────
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
              <Sidebar
                isMobileDrawer
                onClose={() => setSidebarOpen(false)}
                onNewProject={handleNewProject}
                onNavigate={setCurrentPage}
                activeItem={currentPage === 'Builder' ? 'New Project' : currentPage}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      {!isMobile && (
        <div className="shrink-0 z-20">
          <Sidebar
            onNewProject={handleNewProject}
            onNavigate={setCurrentPage}
            activeItem={currentPage === 'Builder' ? 'New Project' : currentPage}
          />
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
            /* ── Other pages placeholder ──────────────────────────────────── */
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
              {/* ── Chat Panel ─────────────────────────────────────────────── */}
              <div className={cn(
                'flex flex-col h-full border-r border-gray-200 dark:border-[#222] bg-white dark:bg-[#0A0A0A] z-10 transition-all duration-500 ease-in-out',
                isMobile
                  ? (mobileView === 'chat' ? 'w-full absolute inset-0' : 'hidden')
                  : (messages.length > 0 ? 'w-[400px] xl:w-[500px] shrink-0' : 'w-full')
              )}>
                {messages.length === 0 ? (
                  /* ── Empty / Hero ─────────────────────────────────────────── */
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
                        <button type="submit" disabled={!input.trim() || isStreaming} className="p-4 rounded-2xl bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50 transition-transform hover:scale-105 active:scale-95 shrink-0">
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
                    {/* ── Desktop Top Bar ──────────────────────────────────── */}
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
                            {isStreaming ? 'Streaming…' : 'Agent Ready'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {currentCode && (
                            <>
                              <button
                                onClick={() => handleCopyCode('toolbar', currentCode)}
                                title="Copy code"
                                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                              >
                                {copiedMsgId === 'toolbar' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => handleDownload(currentCode)}
                                title="Download HTML"
                                className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              {historyIndex > 0 && (
                                <button
                                  onClick={handleUndo}
                                  title="Undo last build"
                                  className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                          <button className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                            <Share className="w-4 h-4" />
                          </button>
                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white dark:bg-white dark:text-black font-medium text-sm hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors">
                            <Rocket className="w-4 h-4" />
                            Deploy
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Messages ─────────────────────────────────────────── */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-6">
                      {messages.map(msg => (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          key={msg.id}
                          className={cn('flex gap-3', msg.role === 'user' ? 'ml-auto flex-row-reverse max-w-[85%]' : 'max-w-[95%]')}
                        >
                          <div className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                            msg.role === 'user' ? 'bg-gray-100 dark:bg-[#222]' : 'bg-gray-900 text-white dark:bg-white dark:text-black'
                          )}>
                            {msg.role === 'user'
                              ? <div className="w-4 h-4 rounded-full bg-gray-400" />
                              : <Zap className="w-4 h-4 text-white dark:text-black" />
                            }
                          </div>

                          <div className={cn('flex flex-col gap-1', msg.role === 'user' ? 'items-end' : 'items-start')}>
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

                            {/* Status indicator */}
                            {msg.status && msg.status !== 'done' && msg.status !== 'error' && (
                              <div className="flex items-center gap-2 text-xs text-gray-500 px-2 mt-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                {msg.status === 'thinking' ? 'Thinking…'
                                  : msg.status === 'building' ? 'Connecting…'
                                  : msg.status === 'streaming' ? 'Typing…'
                                  : msg.status === 'generating_code' ? `Writing code${msg.codeLines ? ` (${msg.codeLines} lines)` : ''}…`
                                  : 'Working…'}
                              </div>
                            )}

                            {/* Done actions */}
                            {msg.status === 'done' && msg.role === 'agent' && currentCode && (
                              <div className="flex items-center gap-1 px-1 mt-0.5">
                                <button
                                  onClick={() => handleCopyCode(msg.id, currentCode)}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#1A1A1A] transition-colors"
                                >
                                  {copiedMsgId === msg.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                                  {copiedMsgId === msg.id ? 'Copied!' : 'Copy code'}
                                </button>
                                <button
                                  onClick={() => handleDownload(currentCode)}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#1A1A1A] transition-colors"
                                >
                                  <Download className="w-3 h-3" />
                                  Download
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* ── Input ─────────────────────────────────────────────── */}
                    <div className="p-4 bg-white dark:bg-[#0A0A0A]">
                      <form
                        onSubmit={handleSubmit}
                        className="relative flex items-end gap-2 bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-xl p-2 focus-within:border-gray-400 dark:focus-within:border-[#555] focus-within:ring-1 focus-within:ring-gray-400 dark:focus-within:ring-[#555] transition-all"
                      >
                        <textarea
                          ref={textareaRef}
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e); }}
                          placeholder="Ask Arc to modify or build something…"
                          className="w-full bg-transparent border-none resize-none max-h-40 min-h-[44px] py-3 px-3 text-sm text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-500"
                          rows={1}
                        />
                        {isStreaming ? (
                          <button
                            type="button"
                            onClick={handleStop}
                            className="p-2.5 mb-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors shrink-0"
                          >
                            <div className="w-4 h-4 bg-white rounded-sm" />
                          </button>
                        ) : (
                          <button
                            type="submit"
                            disabled={!input.trim()}
                            className="p-2.5 mb-1 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50 disabled:bg-gray-300 dark:disabled:bg-[#333] disabled:text-gray-500 transition-colors shrink-0"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                      </form>
                      <div className="text-center mt-2 text-[10px] text-gray-400 dark:text-gray-600">
                        Arc can make mistakes. Always review generated code. · Enter to send, Shift+Enter for newline
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ── Preview Panel ────────────────────────────────────────────── */}
              {messages.length > 0 && (
                <div className={cn(
                  'flex flex-col h-full bg-gray-50 dark:bg-[#050505] transition-all duration-500',
                  isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0' : 'hidden') : 'flex-1',
                  isPreviewFullscreen ? 'fixed inset-0 z-50' : ''
                )}>
                  {/* Tab bar */}
                  <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center px-4 gap-6 bg-white dark:bg-[#0A0A0A] justify-between">
                    <div className="flex gap-6">
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
                      <button
                        onClick={() => setIsPreviewFullscreen(f => !f)}
                        className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#1A1A1A] text-gray-500 transition-colors"
                        title="Toggle fullscreen"
                      >
                        {isPreviewFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Panel content */}
                  <div className="flex-1 relative p-4">
                    <div className="w-full h-full bg-white dark:bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-[#222] shadow-xl dark:shadow-2xl relative flex flex-col">
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
                          {isStreaming && (messages.at(-1)?.status === 'building' || messages.at(-1)?.status === 'generating_code') && (
                            <motion.div
                              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl"
                            >
                              <div className="relative w-48 h-48 flex items-center justify-center">
                                <motion.div
                                  animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 180, 270, 360], borderRadius: ['20%', '50%', '30%', '50%', '20%'] }}
                                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                                  className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-purple-500 opacity-30 blur-2xl"
                                />
                                <motion.div
                                  animate={{ rotate: 360 }}
                                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                                  className="absolute inset-4 rounded-full border border-dashed border-gray-400 dark:border-gray-600 opacity-50"
                                />
                                <Loader2 className="w-10 h-10 animate-spin text-gray-900 dark:text-white" />
                              </div>
                              <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="mt-12 flex flex-col items-center gap-2">
                                <h3 className="text-xl font-semibold tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
                                  Synthesizing Interface
                                </h3>
                                <p className="text-sm text-gray-500 font-mono">
                                  {messages.at(-1)?.codeLines ? `${messages.at(-1)!.codeLines} lines so far…` : 'Applying neural layout models…'}
                                </p>
                              </motion.div>
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
                        <div className="w-full flex-1 bg-gray-900 dark:bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                          {consoleLogs.length === 0
                            ? <div className="text-gray-500 italic">No console output yet…</div>
                            : consoleLogs.map(log => (
                              <div key={log.id} className={cn(
                                'flex gap-2 mb-2',
                                log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-gray-300'
                              )}>
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
                        <div className="w-full flex-1 bg-gray-900 dark:bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                          {logs.map(log => (
                            <div key={log.id} className={cn(
                              'flex gap-2 mb-2',
                              log.type === 'system' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : 'text-gray-400'
                            )}>
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
