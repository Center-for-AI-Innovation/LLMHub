import {
  Sparkles,
  Bot,
  Cpu,
  Server,
  Zap,
} from 'lucide-react';
import type { ModelInfo } from '@/hooks/use-models';
import modelIconsJson from '@/components/model-card/model_icons.json';

const modelOrgIcons: Record<string, string> = modelIconsJson;

// Map model families to icons and colors
const modelIcons: Record<string, any> = {
  'gpt': Sparkles,
  'claude': Bot,
  'llama': Cpu,
  'codellama': Zap,
  'c4ai-command-r': Server,
  'default': Server,
};

export const modelCardGradient = 'from-primary/10 to-primary/5';

// Stable class names for commonly used buttons
export const refreshButtonClass = "h-9 bg-white/50 dark:bg-white/5 border-0 shadow-sm group flex items-center gap-1";
export const fullWidthButtonClass = "min-w-[150px] group";

// Create stable function objects that won't change on re-renders
export const modelUtilFunctions = {
  getModelIcon: (model: ModelInfo) => {
    for (const [key, icon] of Object.entries(modelIcons)) {
      if (model.family.toLowerCase().includes(key.toLowerCase()) || 
          model.id.toLowerCase().includes(key.toLowerCase())) {
        return icon;
      }
    }
    return modelIcons.default;
  },
  getOrgIconPath: (modelName: string): string | null => {
    const filename = modelOrgIcons[modelName];
    return filename ? `/org_icons/${filename}` : null;
  },
};