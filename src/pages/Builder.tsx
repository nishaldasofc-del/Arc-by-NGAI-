import { useState, useRef, useEffect, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Loader2, Play, Terminal, FileCode2, Share, Rocket, Menu, MessageSquare, Folder } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  status?: 'thinking' | 'building' | 'streaming' | 'generating_code' | 'done' | 'error';
  codeLines?: number;
};

type LogEntry = {
  id: string;
  type: 'agent' | 'system';
  message: string;
  timestamp: Date;
};

type ConsoleEntry = {
  id: string;
  type: 'log' | 'error' | 'warn' | 'info';
  message: string;
  timestamp: Date;
};

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentPage, setCurrentPage] = useState('Builder');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs'>('preview');
  const { theme } = useTheme();
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  const [previewCode, setPreviewCode] = useState<string>(
    `<div style="color: ${isDark ? 'white' : 'black'}; padding: 20px; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">Preview will appear here...</div>`
  );
  
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 'init', type: 'system', message: 'Arc dev server started on port 3000', timestamp: new Date() }
  ]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Mobile state
  const [isMobile, setIsMobile] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'preview'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  // Listen for console messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ARC_CONSOLE') {
        setConsoleLogs(prev => [...prev, {
          id: Date.now().toString() + Math.random().toString(),
          type: event.data.level,
          message: event.data.args.join(' '),
          timestamp: new Date()
        }]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleNewProject = () => {
    setMessages([]);
    setPreviewCode(`<div style="color: ${isDark ? 'white' : 'black'}; padding: 20px; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">Preview will appear here...</div>`);
    setLogs([{ id: Date.now().toString(), type: 'system', message: 'Started new project.', timestamp: new Date() }]);
    setConsoleLogs([]);
    setSessionId(null);
    setCurrentPage('Builder');
    if (isMobile) {
      setMobileView('chat');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userText = input;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    
    if (isMobile) {
      setMobileView('preview');
    }
    setActiveTab('logs');

    const agentMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', content: 'Thinking...', status: 'thinking' }]);

    try {
      const prompt = `You are Arc, an expert AI frontend developer. The user wants to build a web UI.
      User request: "${userText}"
      
      You MUST output your response in two parts:
      1. First, output your step-by-step thought process using exactly this format for each step: <step>Building the navigation bar...</step>
      2. Then, output the final code inside a single \`\`\`html block.
      
      Requirements for the code:
      - Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>).
      - Include any necessary JavaScript within <script> tags.
      - Use modern, premium, minimal design (like Vercel, Linear, Stripe). Use Lucide icons via CDN if needed.
      - Make it fully responsive.
      - DO NOT include markdown outside of the <step> tags and the final \`\`\`html block.`;

      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: 'Connecting to ZenoAI...', status: 'building' } : m));

      let currentSessionId = sessionId;
      if (!currentSessionId) {
        try {
          const sessionRes = await fetch('https://zenoai-1.onrender.com/api/v1/session/new', {
            method: 'POST'
          });
          const sessionData = await sessionRes.json();
          currentSessionId = sessionData.session_id || sessionData.sessionId || sessionData.id || sessionData.uuid || 'default-session';
          setSessionId(currentSessionId);
        } catch (e) {
          console.error("Failed to create session", e);
          currentSessionId = 'fallback-session-' + Date.now();
        }
      }

      const res = await fetch('https://zenoai-1.onrender.com/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          session_id: currentSessionId, 
          message: prompt
        })
      });

      if (!res.ok) throw new Error('Network response was not ok');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      let fullText = '';
      let currentCode = '';
      let buffer = '';

      const interceptorScript = `
        <script>
          (function() {
            const originalConsole = {
              log: console.log,
              error: console.error,
              warn: console.warn,
              info: console.info
            };
            function sendToParent(level, args) {
              window.parent.postMessage({
                type: 'ARC_CONSOLE',
                level: level,
                args: Array.from(args).map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
              }, '*');
            }
            console.log = function() { originalConsole.log.apply(console, arguments); sendToParent('log', arguments); };
            console.error = function() { originalConsole.error.apply(console, arguments); sendToParent('error', arguments); };
            console.warn = function() { originalConsole.warn.apply(console, arguments); sendToParent('warn', arguments); };
            console.info = function() { originalConsole.info.apply(console, arguments); sendToParent('info', arguments); };
            window.onerror = function(msg, url, line, col, error) {
              sendToParent('error', [msg + ' at line ' + line]);
              return false;
            };
          })();
        </script>
      `;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          
          for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            if (line === 'data: [DONE]' || line === '[DONE]') continue;
            
            let chunkText = '';
            
            // Robust regex to extract content from JSON, bypassing broken SSE/NDJSON wrappers
            const regex = /"(?:content|text|message|chunk|response)"\s*:\s*"((?:\\.|[^"\\])*)"/g;
            let match;
            let foundJsonContent = false;
            
            while ((match = regex.exec(line)) !== null) {
              foundJsonContent = true;
              try {
                // Safest way to unescape JSON string
                chunkText += JSON.parse('"' + match[1] + '"');
              } catch (e) {
                // Fallback
                chunkText += match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              }
            }
            
            if (!foundJsonContent) {
              let rawText = line;
              if (rawText.startsWith('data: ')) {
                rawText = rawText.slice(6).trim();
              }
              if (rawText === '[DONE]') continue;
              
              // Only treat as raw text if it doesn't look like a broken JSON object
              const looksLikeJson = rawText.startsWith('{"') || rawText.startsWith('[{');
              if (rawText && !looksLikeJson) {
                chunkText = rawText.replace(/\\n/g, '\n');
              }
            }
            
            if (!chunkText) continue;
            
            if (chunkText.length > fullText.length && chunkText.startsWith(fullText)) {
              fullText = chunkText;
            } else {
              fullText += chunkText;
            }
            
            // Extract steps
            const stepMatches = [...fullText.matchAll(/<step>(.*?)<\/step>/g)];
            let latestStep = '';
            if (stepMatches.length > 0) {
              latestStep = stepMatches[stepMatches.length - 1][1];
              setLogs(prev => {
                const lastLog = prev[prev.length - 1];
                if (lastLog?.message !== latestStep) {
                  return [...prev, { id: Date.now().toString(), type: 'agent', message: latestStep, timestamp: new Date() }];
                }
                return prev;
              });
            }

            // Always update status once we start receiving data
            let currentStatus: Message['status'] = 'streaming';
            let currentCodeLines = 0;
            
            let codeContent = '';
            let codeStartIndex = -1;

            if (fullText.includes('```html')) {
              currentStatus = 'generating_code';
              const codeParts = fullText.split('```html');
              if (codeParts.length > 1) {
                codeContent = codeParts[1].split('```')[0];
              }
            } else if (fullText.includes('```')) {
              const codeParts = fullText.split('```');
              if (codeParts.length > 1) {
                currentStatus = 'generating_code';
                codeContent = codeParts[1].split('```')[0];
                if (codeContent.startsWith('html\n')) {
                  codeContent = codeContent.slice(5);
                }
              }
            } else {
              // Look for code without backticks
              const lastStepEnd = fullText.lastIndexOf('</step>');
              const searchArea = lastStepEnd !== -1 ? fullText.slice(lastStepEnd + 7) : fullText;
              
              const doctypeIdx = searchArea.indexOf('<!DOCTYPE html>');
              const htmlIdx = searchArea.indexOf('<html');
              
              let matchIndex = -1;
              if (doctypeIdx !== -1) matchIndex = doctypeIdx;
              else if (htmlIdx !== -1) matchIndex = htmlIdx;
              
              if (matchIndex !== -1) {
                currentStatus = 'generating_code';
                codeContent = searchArea.slice(matchIndex);
                codeStartIndex = lastStepEnd !== -1 ? lastStepEnd + 7 + matchIndex : matchIndex;
              }
            }

            if (codeContent) {
                currentCode = codeContent;
                currentCodeLines = currentCode.split('\n').length;
                setPreviewCode(interceptorScript + currentCode);
            }

            // Update message content in real-time
            let textToShow = fullText;
            if (fullText.includes('```html')) {
              textToShow = fullText.split('```html')[0];
            } else if (fullText.includes('```')) {
              textToShow = fullText.split('```')[0];
            } else if (codeStartIndex !== -1) {
              textToShow = fullText.slice(0, codeStartIndex);
            }

            // Clean up any broken step tags from the UI
            textToShow = textToShow
              .replace(/<step>[\s\S]*?<\/step>/g, '')
              .replace(/<step>[\s\S]*?$/g, '') 
              .replace(/step>[\s\S]*?<\/step>/g, '') 
              .replace(/step>[\s\S]*?$/g, '') 
              .replace(/<\/>[\s\S]*?$/g, '')
              .trim();
            
            setMessages(prev => prev.map(m => m.id === agentMsgId ? { 
              ...m, 
              content: textToShow || (latestStep ? latestStep + '...' : 'Thinking...'),
              status: currentStatus,
              codeLines: currentCodeLines
            } : m));
          }
        }
      }

      const finalTextToShow = fullText.split('```')[0].replace(/<step>[\s\S]*?<\/step>/g, '').trim();
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { 
        ...m, 
        content: finalTextToShow || 'I have updated the preview with your request.', 
        status: 'done' 
      } : m));
      setLogs(prev => [...prev, { id: Date.now().toString(), type: 'system', message: 'Build complete.', timestamp: new Date() }]);
      setActiveTab('preview');
      
    } catch (error) {
      console.error("Agent error:", error);
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: 'Sorry, I encountered an error while building that.', status: 'error' } : m));
      setLogs(prev => [...prev, { id: Date.now().toString(), type: 'system', message: 'Build failed due to an error.', timestamp: new Date() }]);
    }
  };

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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        
        {/* Mobile Header */}
        {isMobile && (
          <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center justify-between px-4 bg-white dark:bg-[#0A0A0A] z-10">
            <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-gray-600 dark:text-gray-400">
              <Menu className="w-5 h-5" />
            </button>
            <div className="font-medium text-sm">Arc by NGAI</div>
            <div className="w-9" /> {/* Spacer for centering */}
          </div>
        )}

        {/* Split View (Desktop) or Tab View (Mobile) */}
        <div className="flex-1 flex overflow-hidden relative">
          {currentPage !== 'Builder' ? (
            <div className="flex-1 overflow-y-auto p-8 bg-white dark:bg-[#0A0A0A]">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl mx-auto">
                <h2 className="text-3xl font-semibold tracking-tight mb-8 text-gray-900 dark:text-white">{currentPage}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
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
              {/* Chat Panel */}
              <div className={cn(
                "flex flex-col h-full border-r border-gray-200 dark:border-[#222] bg-white dark:bg-[#0A0A0A] z-10 transition-all duration-500 ease-in-out",
                isMobile ? (mobileView === 'chat' ? 'w-full absolute inset-0' : 'hidden') : (messages.length > 0 ? 'w-[400px] xl:w-[500px] shrink-0' : 'w-full')
              )}>
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
                    {/* Background glow */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-blue-500/10 to-purple-500/10 blur-3xl rounded-full pointer-events-none" />
                    
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl w-full text-center space-y-8 relative z-10">
                      <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
                        What do you want to build?
                      </h1>
                      <p className="text-gray-500 dark:text-gray-400 text-lg">Prompt Arc to generate UI components, pages, or entire apps.</p>
                      
                      <form 
                        onSubmit={handleSubmit}
                        className="relative flex items-center w-full bg-white/80 dark:bg-[#111]/80 backdrop-blur-xl border border-gray-200 dark:border-[#333] rounded-3xl p-2 shadow-2xl focus-within:ring-2 focus-within:ring-blue-500/20 transition-all"
                      >
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit(e);
                            }
                          }}
                          placeholder="Describe your app..."
                          className="w-full bg-transparent border-none resize-none py-4 px-6 text-lg text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-400"
                          rows={1}
                        />
                        <button 
                          type="submit"
                          disabled={!input.trim()}
                          className="p-4 rounded-2xl bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50 transition-transform hover:scale-105 active:scale-95 shrink-0"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </form>
                      
                      <div className="flex flex-wrap justify-center gap-3 pt-4">
                        {["Build a modern pricing page", "Create a SaaS dashboard", "Design a personal portfolio"].map((suggestion) => (
                          <button 
                            key={suggestion}
                            onClick={() => setInput(suggestion)}
                            className="px-4 py-2 rounded-full bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#222] transition-colors"
                          >
                            {suggestion}
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
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Agent Ready
                  </span>
                </div>
                <div className="flex items-center gap-2">
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

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {messages.map((msg) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id} 
                  className={cn(
                    "flex gap-3 max-w-[85%]",
                    msg.role === 'user' ? "ml-auto flex-row-reverse" : ""
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    msg.role === 'user' ? "bg-gray-100 dark:bg-[#222]" : "bg-gray-900 text-white dark:bg-white dark:text-black"
                  )}>
                    {msg.role === 'user' ? (
                      <div className="w-4 h-4 rounded-full bg-gray-400" />
                    ) : (
                      <div className="w-3 h-3 bg-white dark:bg-black rounded-sm" />
                    )}
                  </div>
                  <div className={cn(
                    "flex flex-col gap-1",
                    msg.role === 'user' ? "items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333] text-gray-900 dark:text-white rounded-tr-sm" 
                        : msg.status === 'error' ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50" : "bg-transparent text-gray-700 dark:text-gray-200"
                    )}>
                      {msg.content}
                    </div>
                    {msg.status && msg.status !== 'done' && msg.status !== 'error' && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 px-2 mt-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {msg.status === 'thinking' ? 'Agent is thinking...' : 
                         msg.status === 'building' ? 'Connecting to ZenoAI...' :
                         msg.status === 'streaming' ? 'Agent is typing...' :
                         msg.status === 'generating_code' ? `Writing code... ${msg.codeLines ? `(${msg.codeLines} lines)` : ''}` : 'Building UI...'}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white dark:bg-[#0A0A0A]">
              <form 
                onSubmit={handleSubmit}
                className="relative flex items-end gap-2 bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-[#333] rounded-xl p-2 focus-within:border-gray-400 dark:focus-within:border-[#555] focus-within:ring-1 focus-within:ring-gray-400 dark:focus-within:ring-[#555] transition-all"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder="Ask Arc to build something..."
                  className="w-full bg-transparent border-none resize-none max-h-32 min-h-[44px] py-3 px-3 text-sm text-gray-900 dark:text-white focus:outline-none placeholder:text-gray-500"
                  rows={1}
                />
                <button 
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2.5 mb-1 rounded-lg bg-gray-900 text-white dark:bg-white dark:text-black disabled:opacity-50 disabled:bg-gray-300 dark:disabled:bg-[#333] disabled:text-gray-500 transition-colors shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <div className="text-center mt-3 text-[10px] text-gray-500 dark:text-gray-600">
                Arc can make mistakes. Verify generated code.
              </div>
            </div>
            </>
          )}
          </div>

          {/* Preview Panel */}
          {messages.length > 0 && (
          <div className={cn(
            "flex flex-col h-full bg-gray-50 dark:bg-[#050505] transition-all duration-500",
            isMobile ? (mobileView === 'preview' ? 'w-full absolute inset-0' : 'hidden') : 'flex-1'
          )}>
            <div className="h-14 shrink-0 border-b border-gray-200 dark:border-[#222] flex items-center px-4 gap-6 bg-white dark:bg-[#0A0A0A]">
              <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={Play} label="Preview" />
              <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={Terminal} label="Console" />
              <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={FileCode2} label="Logs" />
            </div>
            
            <div className="flex-1 relative p-4">
              <div className="w-full h-full bg-white dark:bg-white rounded-xl overflow-hidden border border-gray-200 dark:border-[#222] shadow-xl dark:shadow-2xl relative flex flex-col">
                {/* Browser chrome mockup */}
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
                
                {activeTab === 'preview' && (
                  <div className="relative w-full flex-1 bg-white">
                    {(messages[messages.length - 1]?.status === 'building' || messages[messages.length - 1]?.status === 'generating_code') && (
                      <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl"
                      >
                        <div className="relative w-48 h-48 flex items-center justify-center">
                          <motion.div
                            animate={{
                              scale: [1, 1.2, 1],
                              rotate: [0, 90, 180, 270, 360],
                              borderRadius: ["20%", "50%", "30%", "50%", "20%"]
                            }}
                            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                            className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-purple-500 opacity-30 blur-2xl"
                          />
                          <motion.div 
                            animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                            className="absolute inset-4 rounded-full border border-dashed border-gray-400 dark:border-gray-600 opacity-50"
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="w-10 h-10 animate-spin text-gray-900 dark:text-white" />
                          </div>
                        </div>
                        <motion.div 
                          animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}
                          className="mt-12 flex flex-col items-center gap-2"
                        >
                          <h3 className="text-xl font-semibold tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
                            Synthesizing Interface
                          </h3>
                          <p className="text-sm text-gray-500 font-mono">Applying neural layout models...</p>
                        </motion.div>
                      </motion.div>
                    )}
                    <iframe 
                      srcDoc={previewCode}
                      className="w-full h-full border-none"
                      title="Live Preview"
                    />
                  </div>
                )}
                {activeTab === 'console' && (
                  <div className="w-full flex-1 bg-gray-900 dark:bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                    {consoleLogs.length === 0 ? (
                      <div className="text-gray-500 italic">No console output yet...</div>
                    ) : (
                      consoleLogs.map(log => (
                        <div key={log.id} className={cn(
                          "flex gap-2 mb-2 font-mono",
                          log.type === 'error' ? "text-red-400" : log.type === 'warn' ? "text-amber-400" : "text-gray-300"
                        )}>
                          <span className="shrink-0 text-gray-500">
                            [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}]
                          </span>
                          <span className="shrink-0">&gt;</span>
                          <span className="whitespace-pre-wrap break-words">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={consoleEndRef} />
                  </div>
                )}
                {activeTab === 'logs' && (
                  <div className="w-full flex-1 bg-gray-900 dark:bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                    {logs.map(log => (
                      <div key={log.id} className={cn(
                        "flex gap-2 mb-2 font-mono",
                        log.type === 'system' ? "text-green-400" : "text-gray-400"
                      )}>
                        <span className="shrink-0 text-gray-600">
                          [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}]
                        </span>
                        <span className="shrink-0">{log.type === 'system' ? '[System]' : '[Agent]'}</span>
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

        {/* Mobile Bottom Navigation */}
        {isMobile && (
          <div className="h-14 shrink-0 border-t border-gray-200 dark:border-[#222] flex bg-white dark:bg-[#0A0A0A] z-20">
            <button 
              onClick={() => setMobileView('chat')}
              className={cn("flex-1 flex flex-col items-center justify-center gap-1 transition-colors", mobileView === 'chat' ? "text-gray-900 dark:text-white" : "text-gray-500")}
            >
              <MessageSquare className="w-5 h-5" />
              <span className="text-[10px] font-medium">Chat</span>
            </button>
            <button 
              onClick={() => setMobileView('preview')}
              className={cn("flex-1 flex flex-col items-center justify-center gap-1 transition-colors", mobileView === 'preview' ? "text-gray-900 dark:text-white" : "text-gray-500")}
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

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-full border-b-2 px-1 text-sm font-medium transition-colors",
        active ? "border-gray-900 text-gray-900 dark:border-white dark:text-white" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
