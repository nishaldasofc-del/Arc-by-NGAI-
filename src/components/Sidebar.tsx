import { useState } from 'react';
import { motion } from 'motion/react';
import { Folder, History, Settings, Plus, PanelLeftClose, PanelLeftOpen, Sun, Moon, Monitor, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

export default function Sidebar({ 
  isMobileDrawer, 
  onClose,
  onNewProject,
  onNavigate,
  activeItem = 'New Project'
}: { 
  isMobileDrawer?: boolean, 
  onClose?: () => void,
  onNewProject?: () => void,
  onNavigate?: (page: string) => void,
  activeItem?: string
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleItemClick = (label: string) => {
    if (label === 'New Project' && onNewProject) {
      onNewProject();
    } else if (onNavigate) {
      onNavigate(label);
    }
    if (isMobileDrawer && onClose) {
      onClose();
    }
  };

  return (
    <motion.div 
      animate={{ width: isMobileDrawer ? '100%' : (isCollapsed ? 64 : 240) }}
      className="h-full bg-gray-50 dark:bg-[#0A0A0A] border-r border-gray-200 dark:border-[#222] flex flex-col transition-all duration-300"
    >
      <div className="p-4 flex items-center justify-between border-b border-gray-200 dark:border-[#222]">
        {(!isCollapsed || isMobileDrawer) && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-900 dark:bg-white rounded-md flex items-center justify-center">
              <div className="w-3 h-3 bg-white dark:bg-black rounded-sm" />
            </div>
            <span className="font-medium text-sm tracking-tight text-gray-900 dark:text-white">Arc</span>
          </div>
        )}
        {isMobileDrawer ? (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#1A1A1A] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors",
              isCollapsed && "mx-auto"
            )}
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="flex-1 py-4 flex flex-col gap-1 px-2">
        <SidebarItem icon={Plus} label="New Project" isCollapsed={isCollapsed && !isMobileDrawer} primary onClick={() => handleItemClick('New Project')} />
        <div className="my-2 border-t border-gray-200 dark:border-[#222] mx-2" />
        <SidebarItem icon={Folder} label="Projects" isCollapsed={isCollapsed && !isMobileDrawer} active={activeItem === 'Projects'} onClick={() => handleItemClick('Projects')} />
        <SidebarItem icon={History} label="History" isCollapsed={isCollapsed && !isMobileDrawer} active={activeItem === 'History'} onClick={() => handleItemClick('History')} />
        <SidebarItem icon={Folder} label="Files" isCollapsed={isCollapsed && !isMobileDrawer} active={activeItem === 'Files'} onClick={() => handleItemClick('Files')} />
      </div>

      <div className="p-2 border-t border-gray-200 dark:border-[#222] flex flex-col gap-1">
        <SidebarItem icon={Settings} label="Settings" isCollapsed={isCollapsed && !isMobileDrawer} active={activeItem === 'Settings'} onClick={() => handleItemClick('Settings')} />
        
        {(!isCollapsed || isMobileDrawer) && (
          <div className="flex items-center justify-between px-3 py-2 mt-2 bg-gray-200/50 dark:bg-[#1A1A1A] rounded-lg">
            <button onClick={() => setTheme('light')} className={cn("p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors", theme === 'light' && "bg-white dark:bg-[#333] text-gray-900 dark:text-white shadow-sm")}><Sun className="w-4 h-4" /></button>
            <button onClick={() => setTheme('system')} className={cn("p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors", theme === 'system' && "bg-white dark:bg-[#333] text-gray-900 dark:text-white shadow-sm")}><Monitor className="w-4 h-4" /></button>
            <button onClick={() => setTheme('dark')} className={cn("p-1.5 rounded-md text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors", theme === 'dark' && "bg-white dark:bg-[#333] text-gray-900 dark:text-white shadow-sm")}><Moon className="w-4 h-4" /></button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function SidebarItem({ icon: Icon, label, isCollapsed, primary, active, onClick }: { icon: any, label: string, isCollapsed: boolean, primary?: boolean, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
        primary 
          ? "bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200" 
          : active 
            ? "bg-gray-200/80 text-gray-900 dark:bg-[#1A1A1A] dark:text-white"
            : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50 dark:text-gray-400 dark:hover:text-white dark:hover:bg-[#1A1A1A]",
        isCollapsed && "justify-center px-0"
      )}
      title={isCollapsed ? label : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!isCollapsed && <span className="text-sm font-medium truncate">{label}</span>}
    </button>
  );
}
