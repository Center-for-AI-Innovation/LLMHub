import {
  Sparkles,
  Bot,
  Cpu,
  Server,
  Zap,
} from 'lucide-react';
import type { ModelInfo } from '@/hooks/use-models';

// Map model families to icons and colors
const modelIcons: Record<string, any> = {
  'gpt': Sparkles,
  'claude': Bot,
  'llama': Cpu,
  'codellama': Zap,
  'c4ai-command-r': Server,
  'default': Server,
};

// Color gradients for different model families
const modelGradients: Record<string, string> = {
  'gpt': 'from-emerald-500/10 to-emerald-500/5',
  'claude': 'from-purple-500/10 to-purple-500/5',
  'llama': 'from-blue-500/10 to-blue-500/5',
  'codellama': 'from-amber-500/10 to-amber-500/5',
  'c4ai': 'from-orange-500/10 to-orange-500/5',
  'default': 'from-primary/10 to-primary/5',
};

// Stable class names for commonly used buttons
export const refreshButtonClass = "h-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm group flex items-center gap-1";
export const fullWidthButtonClass = "min-w-[150px] group";

// Create stable function objects that won't change on re-renders
export const modelUtilFunctions = {
  getModelIcon: (model: ModelInfo) => {
    // Try to match by family first
    for (const [key, icon] of Object.entries(modelIcons)) {
      if (model.family.toLowerCase().includes(key.toLowerCase()) || 
          model.id.toLowerCase().includes(key.toLowerCase())) {
        return icon;
      }
    }
    // Default icon
    return modelIcons.default;
  },
  getModelGradient: (model: ModelInfo) => {
    // Try to match by family first
    for (const [key, gradient] of Object.entries(modelGradients)) {
      if (model.family.toLowerCase().includes(key.toLowerCase()) || 
          model.id.toLowerCase().includes(key.toLowerCase())) {
        return gradient;
      }
    }
    // Default gradient
    return modelGradients.default;
  }
}; 