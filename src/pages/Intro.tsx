import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { LayoutTemplate, Box, LayoutDashboard, Sparkles, Plus } from 'lucide-react';

const starterCards = [
  { id: 'website', title: 'Build Website', icon: LayoutTemplate, description: 'Landing pages, portfolios, blogs' },
  { id: 'saas', title: 'Build SaaS', icon: Box, description: 'Web apps, tools, platforms' },
  { id: 'dashboard', title: 'Build Dashboard', icon: LayoutDashboard, description: 'Admin panels, analytics, CRM' },
  { id: 'ai-tool', title: 'Build AI Tool', icon: Sparkles, description: 'Chatbots, generators, agents' },
  { id: 'scratch', title: 'Start from scratch', icon: Plus, description: 'Empty canvas, infinite possibilities' },
];

export default function Intro() {
  const navigate = useNavigate();

  const handleSelect = (id: string) => {
    navigate(`/builder?template=${id}`);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-4xl"
      >
        <div className="text-center mb-16">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="w-16 h-16 bg-white rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.15)]"
          >
            <div className="w-8 h-8 bg-black rounded-md" />
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-medium tracking-tight mb-4">
            Arc by NGAI
          </h1>
          <p className="text-xl text-gray-400 font-light">
            "Build anything with AI agents"
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {starterCards.map((card, index) => (
            <motion.button
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.1, duration: 0.5 }}
              onClick={() => handleSelect(card.id)}
              className="group text-left p-6 rounded-2xl bg-[#111111] border border-[#222] hover:border-[#444] hover:bg-[#161616] transition-all duration-300 flex flex-col gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-[#1A1A1A] border border-[#333] flex items-center justify-center group-hover:scale-110 group-hover:bg-white group-hover:text-black transition-all duration-300">
                <card.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-200 group-hover:text-white transition-colors">{card.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{card.description}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
