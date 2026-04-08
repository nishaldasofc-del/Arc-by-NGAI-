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
  Square, StopCircle
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type MessageStatus =
  | 'thinking' | 'streaming' | 'done' | 'error' | 'building';

type AgentStep = {
  id: string; label: string; detail?: string;
  status: 'pending' | 'active' | 'done';
};

type Message = {
  id: string; role: 'user' | 'agent'; content: string;
  status?: MessageStatus; timestamp: Date;
  agentSteps?: AgentStep[];
  codeLines?: number;
  buildTime?: number;
  fileCount?: number;
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

async function callAI(prompt: string, maxTokens = 1500): Promise<string> {
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

// ─── Build System Prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(userText: string, existingFiles: ProjectFile[]): string {
  const fileContext = existingFiles.length > 0
    ? `\n\nEXISTING PROJECT FILES:\n${existingFiles.map(f => `=== FILE: ${f.name} ===\n${f.content}\n=== END FILE ===`).join('\n\n')}\n\nModify or extend these files as needed. Keep existing code unless the user wants changes.`
    : '';

  return `You are an elite AI software engineer. Build exactly what the user asks.

USER REQUEST: "${userText}"
${fileContext}

OUTPUT FORMAT — use this EXACT format for every file:

=== FILE: path/filename.ext ===
[complete file content here]
=== END FILE ===

CRITICAL RULES:
1. Output ALL files needed — HTML, CSS, JS, backend, config, everything
2. Each file must be COMPLETE — never truncate, never use placeholders like "// ... rest of code"
3. For web projects: inline CSS and JS into HTML only if it's truly a single-file app; otherwise use separate files
4. For full-stack apps: include server files (Node/Express, Python/Flask, etc.), package.json, .env.example, README.md
5. Files must actually work — proper imports, correct paths, working logic
6. Use modern, production-quality code — no toy examples
7. If building a React/Vue app, include all component files separately
8. Think step by step before generating: plan the architecture first using <think>...</think> tags, then output files

Generate the complete project now:`;
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

function parseFilesFromOutput(text: string): ProjectFile[] {
  // Match === FILE: name === ... === END FILE === blocks
  const fileMatches = [...text.matchAll(/=== FILE: (.+?) ===\n([\s\S]*?)(?:=== END FILE ===|(?==== FILE:)|$)/g)];
  if (fileMatches.length > 0) {
    return fileMatches.map(m => {
      const name = m[1].trim();
      const content = m[2].replace(/\n?=== END FILE ===$/, '').trim();
      const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
      return { id: `file-${name}`, name, language: ext, content };
    });
  }

  // Fallback: try to extract from markdown code blocks
  const codeBlocks = [...text.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
  if (codeBlocks.length > 0) {
    return codeBlocks.map((m, i) => {
      const lang = m[1]?.toLowerCase() ?? 'txt';
      const content = m[2].trim();
      const name = lang === 'html' ? 'index.html'
        : lang === 'css' ? 'style.css'
        : lang === 'javascript' || lang === 'js' ? 'script.js'
        : lang === 'python' || lang === 'py' ? 'main.py'
        : `file-${i + 1}.${lang}`;
      return { id: `file-${name}-${i}`, name, language: lang, content };
    });
  }

  // Last resort: raw HTML
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
  if (!htmlFile) return '';

  let html = htmlFile.content;

  // Inline CSS files that are linked
  files.filter(f => f.language === 'css').forEach(cssFile => {
    const linkPattern = new RegExp(`<link[^>]*href=["']${cssFile.name.replace('.', '\\.')}["'][^>]*>`, 'gi');
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, `<style>${cssFile.content}</style>`);
    } else {
      html = html.replace('</head>', `<style>${cssFile.content}</style></head>`);
    }
  });

  // Inline JS files that are linked
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

        {/* Inline new file input — no native prompt() */}
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

// ─── Agent Step Progress ──────────────────────────────────────────────────────

function AgentProgress({ steps }: { steps: AgentStep[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm rounded-2xl overflow-hidden arc-glass">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-white/[0.06] flex items-center gap-2">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
          <Cpu className="w-4 h-4 text-violet-500" />
        </motion.div>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Arc is building…</span>
      </div>
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
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
      className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
      {content}
      <span className="inline-block w-1.5 h-3.5 bg-violet-500/60 ml-0.5 animate-pulse align-middle rounded-sm" />
    </motion.div>
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const buildStartRef = useRef<number>(0);
  const projectFilesRef = useRef<ProjectFile[]>([]);

  // Keep ref in sync for use inside async closures
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

  // ── Scroll to bottom ───────────────────────────────────────────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [consoleLogs]);

  // ── ESC to close command palette ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setSearchOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  // ── Auto-select first file ─────────────────────────────────────────────────
  useEffect(() => {
    if (projectFiles.length > 0 && !activeFileId) {
      setActiveFileId(projectFiles[0].id);
    }
  }, [projectFiles, activeFileId]);

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

  const activeFile = projectFiles.find(f => f.id === activeFileId) ?? null;

  // ── File management ────────────────────────────────────────────────────────
  const addFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
    const newFile: ProjectFile = { id: `file-${name}-${Date.now()}`, name, language: ext, content: '' };
    setProjectFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
    setActiveTab('code');
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

  // ── Download (zip if multiple files) ──────────────────────────────────────
  const handleDownload = async () => {
    if (projectFiles.length === 0 && !previewCode) return;

    if (projectFiles.length === 1) {
      const file = projectFiles[0];
      const blob = new Blob([file.content], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    } else if (projectFiles.length > 1) {
      // Try to use JSZip if available, otherwise download individually
      try {
        // @ts-ignore
        const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
        const zip = new JSZip();
        projectFiles.forEach(f => zip.file(f.name, f.content));
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'arc-project.zip';
        a.click();
      } catch {
        // Fallback: stagger downloads
        for (let i = 0; i < projectFiles.length; i++) {
          await new Promise(r => setTimeout(r, i * 300));
          const blob = new Blob([projectFiles[i].content], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = projectFiles[i].name;
          a.click();
        }
      }
    } else if (previewCode) {
      const blob = new Blob([previewCode], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'index.html';
      a.click();
    }
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
    addLog('system', 'Stream cancelled by user.');
    setMessages(prev => prev.map(m =>
      m.status === 'building' || m.status === 'streaming'
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
    if (isMobile) setMobileView('chat');
  };

  // ── Build Flow ─────────────────────────────────────────────────────────────
  const runBuild = async (userText: string, intent: 'build' | 'edit') => {
    setIsStreaming(true);
    buildStartRef.current = Date.now();
    if (isMobile) setMobileView('preview');
    setActiveTab('logs');

    const buildMsgId = `build-${Date.now()}`;
    const initialSteps: AgentStep[] = [
      { id: 'analyze', label: 'Analyzing requirements', status: 'active' },
      { id: 'plan', label: 'Planning architecture', status: 'pending' },
      { id: 'generate', label: 'Generating code', status: 'pending' },
      { id: 'finalize', label: 'Assembling files', status: 'pending' },
    ];

    setMessages(prev => [...prev, {
      id: buildMsgId, role: 'agent', content: '', status: 'building',
      timestamp: new Date(), agentSteps: initialSteps,
    }]);

    const advanceStep = (stepId: string) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map(s => {
          if (s.status === 'active') return { ...s, status: 'done' as const };
          if (s.id === stepId) return { ...s, status: 'active' as const };
          return s;
        }) ?? [];
        return { ...m, agentSteps: steps };
      }));
    };

    const updateStepDetail = (stepId: string, detail: string) => {
      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map(s => s.id === stepId ? { ...s, detail } : s) ?? [];
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
        }
      }

      advanceStep('plan');
      addLog('agent', `Planning ${intent === 'edit' ? 'edits' : 'new project'}: "${userText}"`);

      const currentFiles = projectFilesRef.current;
      const prompt = buildSystemPrompt(userText, currentFiles);

      advanceStep('generate');
      addLog('agent', 'Generating code files…');

      const res = await fetch(`${BASE_URL}/api/v1/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, message: prompt }),
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

          // Real-time file detection
          const partialFiles = parseFilesFromOutput(fullText);
          if (partialFiles.length > lastParsedFileCount) {
            lastParsedFileCount = partialFiles.length;
            const latestFile = partialFiles[partialFiles.length - 1];
            updateStepDetail('generate', latestFile.name);
            addLog('agent', `Writing ${latestFile.name}…`);
          }
        }
      }

      advanceStep('finalize');

      // Final file parse
      let finalFiles = parseFilesFromOutput(fullText);

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

      setProjectFiles(finalFiles);
      if (finalFiles.length > 0) setActiveFileId(finalFiles[0].id);

      const preview = buildPreviewHtml(finalFiles);
      if (preview) setPreviewCode(preview);

      const elapsed = Math.round((Date.now() - buildStartRef.current) / 1000);
      setBuildTime(elapsed);

      pushHistory(finalFiles, userText.slice(0, 40));
      const lineCount = finalFiles.reduce((acc, f) => acc + f.content.split('\n').length, 0);

      setMessages(prev => prev.map(m => {
        if (m.id !== buildMsgId) return m;
        const steps = m.agentSteps?.map(s => ({ ...s, status: 'done' as const })) ?? [];
        return {
          ...m, status: 'done',
          agentSteps: steps,
          content: `Built ${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''} · ${lineCount} lines · ${elapsed}s`,
          codeLines: lineCount, buildTime: elapsed, fileCount: finalFiles.length,
        };
      }));

      addLog('system', `Done: ${finalFiles.length} files, ${lineCount} lines in ${elapsed}s.`);
      setActiveTab('preview');
      setShowFileTree(true);
      if (finalFiles.length > 0) setActiveFileId(finalFiles[0].id);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog('error', errMsg);
      setMessages(prev => prev.map(m =>
        m.id === buildMsgId
          ? { ...m, status: 'error', content: `Build failed: ${errMsg}`, agentSteps: m.agentSteps?.map(s => s.status === 'active' ? { ...s, status: 'pending' as const } : s) }
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
      let sid = sessionId || `fallback-${Date.now()}`;
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
    if (!text || isStreaming) return;

    setInput('');
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`, role: 'user', content: text, timestamp: new Date(),
    }]);

    // Show thinking indicator
    const thinkingId = `thinking-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: thinkingId, role: 'agent', content: '', status: 'thinking', timestamp: new Date(),
    }]);

    // Get conversation context (last 3 messages)
    const ctx = messages.slice(-3).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join('\n');

    let intent: 'chat' | 'build' | 'edit';
    try {
      intent = await detectIntent(text, projectFiles.length > 0, ctx);
    } catch {
      intent = projectFiles.length > 0 ? 'edit' : 'build';
    }

    // Remove thinking bubble
    setMessages(prev => prev.filter(m => m.id !== thinkingId));

    if (intent === 'chat') {
      await runChat(text);
    } else {
      await runBuild(text, intent as 'build' | 'edit');
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
        .arc-input-glass { background:var(--arc-glass-bg); border:1px solid var(--arc-glass-border); box-shadow:0 4px 20px rgba(0,0,0,0.05); }
        .dark .arc-input-glass { box-shadow:0 8px 32px rgba(0,0,0,0.3); }
        .arc-input-glass:focus-within { border-color:rgba(139,92,246,0.4); box-shadow:0 0 0 3px rgba(139,92,246,0.12); }
        .arc-scrollbar::-webkit-scrollbar { width:4px; }
        .arc-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .arc-scrollbar::-webkit-scrollbar-thumb { background:rgba(156,163,175,0.3); border-radius:4px; }
        .dark .arc-scrollbar::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); }
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
              isMobile ? (mobileView === 'chat' ? 'w-full' : 'hidden') : messages.length > 0 ? 'w-[380px] shrink-0' : 'flex-1'
            )}>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto arc-scrollbar px-4 py-6 space-y-4">
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

                        {/* Build progress */}
                        {msg.role === 'agent' && msg.status === 'building' && msg.agentSteps && (
                          <AgentProgress steps={msg.agentSteps} />
                        )}

                        {/* Done agent message */}
                        {msg.role === 'agent' && msg.status === 'done' && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="flex items-start gap-2.5 max-w-sm">
                            <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="arc-glass rounded-2xl px-4 py-3 text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                              {msg.content}
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

                        {/* Plain agent message (no status) */}
                        {msg.role === 'agent' && !msg.status && msg.content && (
                          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                            className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-tl-sm arc-glass text-sm text-gray-800 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {msg.content}
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
                isMobile && messages.length > 0 ? "pb-[calc(1rem+env(safe-area-inset-bottom)+3.5rem)]" : "pb-[calc(1rem+env(safe-area-inset-bottom))]"
              )}>
                <div className={cn('flex flex-col gap-2 rounded-2xl arc-input-glass p-3', isStreaming && 'opacity-80')}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isStreaming ? 'Arc is working…' : projectFiles.length > 0 ? 'Ask for changes, edits, or a new project…' : 'Describe what you want to build…'}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-gray-500 resize-none outline-none leading-relaxed"
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      <Hash className="w-3 h-3" />
                      <span>Shift+Enter for newline</span>
                    </div>
                    {isStreaming ? (
                      <button type="button" onClick={handleStop}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-100 dark:bg-red-500/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors">
                        <Square className="w-3 h-3 fill-current" /> Stop
                      </button>
                    ) : (
                      <button onClick={handleSubmit} disabled={!input.trim() || isStreaming}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl arc-btn-3d-primary text-white text-xs font-semibold disabled:opacity-30">
                        <Sparkles className="w-3.5 h-3.5" /> Send
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

        {/* Mobile bottom nav — always visible on mobile */}
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
