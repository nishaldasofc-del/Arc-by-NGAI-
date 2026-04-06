import { useState } from 'react';
import { motion } from 'motion/react';
import { Folder, History, Settings, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../lib/utils';

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <motion.div 
      animate={{ width: isCollapsed ? 64 : 240 }}
      className="h-full bg-[#0A0A0A] border-r border-[#222] flex flex-col transition-all duration-300"
    >
      <div className="p-4 flex items-center justify-between border-b border-[#222]">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-white rounded-md flex items-center justify-center">
              <div className="w-3 h-3 bg-black rounded-sm" />
            </div>
            <span className="font-medium text-sm tracking-tight text-white">Arc</span>
          </div>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "p-1.5 rounded-lg hover:bg-[#1A1A1A] text-gray-400 hover:text-white transition-colors",
            isCollapsed && "mx-auto"
          )}
        >
          {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 py-4 flex flex-col gap-1 px-2">
        <SidebarItem icon={Plus} label="New Project" isCollapsed={isCollapsed} primary />
        <div className="my-2 border-t border-[#222] mx-2" />
        <SidebarItem icon={Folder} label="Projects" isCollapsed={isCollapsed} />
        <SidebarItem icon={History} label="History" isCollapsed={isCollapsed} />
        <SidebarItem icon={Folder} label="Files" isCollapsed={isCollapsed} />
      </div>

      <div className="p-2 border-t border-[#222]">
        <SidebarItem icon={Settings} label="Settings" isCollapsed={isCollapsed} />
      </div>
    </motion.div>
  );
}

function SidebarItem({ icon: Icon, label, isCollapsed, primary }: { icon: any, label: string, isCollapsed: boolean, primary?: boolean }) {
  return (
    <button 
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
        primary 
          ? "bg-white text-black hover:bg-gray-200" 
          : "text-gray-400 hover:text-white hover:bg-[#1A1A1A]",
        isCollapsed && "justify-center px-0"
      )}
      title={isCollapsed ? label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!isCollapsed && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  );
}
