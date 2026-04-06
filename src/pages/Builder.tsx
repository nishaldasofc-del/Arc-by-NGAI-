import { useState, useRef, useEffect, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Loader2, Play, Terminal, FileCode2, Share, Rocket } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { cn } from '../lib/utils';

type Message = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  status?: 'thinking' | 'building' | 'done';
};

export default function Builder() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'agent', content: 'What would you like to build today?', status: 'done' }
  ]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'console' | 'logs'>('preview');
  const [previewCode, setPreviewCode] = useState<string>('<div style="color: white; padding: 20px; font-family: sans-serif;">Preview will appear here...</div>');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Simulate Agent Thinking & Building
    const agentMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', content: 'Thinking...', status: 'thinking' }]);

    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: 'Creating layout...', status: 'building' } : m));
    }, 1000);

    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: 'Adding components and styling...', status: 'building' } : m));
    }, 2500);

    setTimeout(() => {
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, content: 'I have updated the preview with your request.', status: 'done' } : m));
      
      // Update preview with some mock generated UI
      setPreviewCode(`
        <div style="min-height: 100vh; background-color: #0A0A0A; color: white; font-family: system-ui, sans-serif; padding: 40px;">
          <div style="max-w-4xl mx-auto">
            <h1 style="font-size: 2rem; font-weight: 600; margin-bottom: 1rem;">Generated UI</h1>
            <div style="background: #111; border: 1px solid #222; border-radius: 12px; padding: 24px;">
              <p style="color: #888;">This is a simulated live preview of the generated application based on: "${userMsg.content}"</p>
              <button style="margin-top: 16px; background: white; color: black; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 500; cursor: pointer;">
                Interactive Button
              </button>
            </div>
          </div>
        </div>
      `);
    }, 4000);
  };

  return (
    <div className="h-screen w-full flex bg-[#0A0A0A] overflow-hidden text-white">
      <Sidebar />
      
      {/* Center Chat Area */}
      <div className="flex-1 flex flex-col min-w-[400px] border-r border-[#222] relative z-10 shadow-[20px_0_40px_rgba(0,0,0,0.5)]">
        {/* Top Bar */}
        <div className="h-14 border-b border-[#222] flex items-center justify-between px-4 bg-[#0A0A0A]/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm">Untitled Project</span>
            <span className="px-2 py-0.5 rounded-full bg-[#1A1A1A] border border-[#333] text-xs text-gray-400 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Agent Ready
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-md hover:bg-[#1A1A1A] text-gray-400 hover:text-white transition-colors">
              <Share className="w-4 h-4" />
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-black font-medium text-sm hover:bg-gray-200 transition-colors">
              <Rocket className="w-4 h-4" />
              Deploy
            </button>
          </div>
        </div>

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
                msg.role === 'user' ? "bg-[#222]" : "bg-white text-black"
              )}>
                {msg.role === 'user' ? (
                  <div className="w-4 h-4 rounded-full bg-gray-400" />
                ) : (
                  <div className="w-3 h-3 bg-black rounded-sm" />
                )}
              </div>
              <div className={cn(
                "flex flex-col gap-1",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-[#1A1A1A] border border-[#333] text-white rounded-tr-sm" 
                    : "bg-transparent text-gray-200"
                )}>
                  {msg.content}
                </div>
                {msg.status && msg.status !== 'done' && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 px-2 mt-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {msg.status === 'thinking' ? 'Agent is thinking...' : 'Building UI...'}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-[#0A0A0A]">
          <form 
            onSubmit={handleSubmit}
            className="relative flex items-end gap-2 bg-[#111] border border-[#333] rounded-xl p-2 focus-within:border-[#555] focus-within:ring-1 focus-within:ring-[#555] transition-all"
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
              className="w-full bg-transparent border-none resize-none max-h-32 min-h-[44px] py-3 px-3 text-sm text-white focus:outline-none placeholder:text-gray-500"
              rows={1}
            />
            <button 
              type="submit"
              disabled={!input.trim()}
              className="p-2.5 mb-1 rounded-lg bg-white text-black disabled:opacity-50 disabled:bg-[#333] disabled:text-gray-500 transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="text-center mt-3 text-[10px] text-gray-600">
            Arc can make mistakes. Verify generated code.
          </div>
        </div>
      </div>

      {/* Right Live Preview Panel */}
      <motion.div 
        initial={{ x: 100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="flex-1 flex flex-col bg-[#050505] relative"
      >
        <div className="h-14 border-b border-[#222] flex items-center px-4 gap-6 bg-[#0A0A0A]">
          <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={Play} label="Preview" />
          <TabButton active={activeTab === 'console'} onClick={() => setActiveTab('console')} icon={Terminal} label="Console" />
          <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={FileCode2} label="Logs" />
        </div>
        
        <div className="flex-1 relative p-4">
          <div className="w-full h-full bg-white rounded-xl overflow-hidden border border-[#222] shadow-2xl relative">
            {/* Browser chrome mockup */}
            <div className="h-10 bg-[#f5f5f5] border-b border-gray-200 flex items-center px-4 gap-2">
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
              <iframe 
                srcDoc={previewCode}
                className="w-full h-[calc(100%-40px)] border-none bg-white"
                title="Live Preview"
              />
            )}
            {activeTab === 'console' && (
              <div className="w-full h-[calc(100%-40px)] bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                <div className="flex gap-2 text-gray-500 mb-2">
                  <span>&gt;</span>
                  <span>Arc dev server started on port 3000</span>
                </div>
                <div className="flex gap-2 text-green-400 mb-2">
                  <span>&gt;</span>
                  <span>Compiled successfully</span>
                </div>
              </div>
            )}
            {activeTab === 'logs' && (
              <div className="w-full h-[calc(100%-40px)] bg-[#0A0A0A] text-gray-300 font-mono text-xs p-4 overflow-auto">
                <div className="text-gray-500 mb-1">[Agent] Analyzing request...</div>
                <div className="text-gray-500 mb-1">[Agent] Generating component tree...</div>
                <div className="text-gray-500 mb-1">[Agent] Applying Tailwind classes...</div>
                <div className="text-green-400 mb-1">[Agent] Build complete.</div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-full border-b-2 px-1 text-sm font-medium transition-colors",
        active ? "border-white text-white" : "border-transparent text-gray-500 hover:text-gray-300"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
