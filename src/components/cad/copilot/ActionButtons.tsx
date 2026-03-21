import { motion } from 'framer-motion';
import { FileText, FlaskConical, Cpu, Wrench } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

interface ActionButtonsProps {
  onAction: (prompt: string) => void;
  disabled: boolean;
}

const ACTIONS = [
  {
    id: 'quote',
    label: 'Generate Quote',
    icon: FileText,
    prompt: 'Generate a full manufacturing quote for the uploaded model including material cost, machining time, tooling, and lead time breakdown.',
    requiresFile: true,
  },
  {
    id: 'simulate',
    label: 'Run Simulation',
    icon: FlaskConical,
    prompt: 'Run a stress analysis and manufacturability simulation on the uploaded model. Include safety factor, max von Mises stress, and fatigue life predictions.',
    requiresFile: true,
  },
  {
    id: 'analyze',
    label: 'Deep Analysis',
    icon: Cpu,
    prompt: 'Perform a comprehensive geometry analysis: classify all faces, detect holes, measure wall thickness, check draft angles, and build a topology graph.',
    requiresFile: true,
  },
  {
    id: 'optimize',
    label: 'Suggest Fixes',
    icon: Wrench,
    prompt: 'Analyze this part for design improvements. Suggest changes to reduce cost, improve manufacturability, and minimize production risks.',
    requiresFile: true,
  },
];

export function ActionButtons({ onAction, disabled }: ActionButtonsProps) {
  const uploadedFile = useAppStore((s) => s.uploadedFile);
  const analysisResult = useAppStore((s) => s.analysisResult);

  return (
    <div className="px-3 pb-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
        Quick Actions
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {ACTIONS.map((action) => {
          const fileReady = !action.requiresFile || !!uploadedFile;
          const isDisabled = disabled || !fileReady;

          return (
            <motion.button
              key={action.id}
              whileHover={!isDisabled ? { scale: 1.02 } : {}}
              whileTap={!isDisabled ? { scale: 0.98 } : {}}
              onClick={() => {
                if (isDisabled) return;
                // Build context-aware prompt
                let prompt = action.prompt;
                if (uploadedFile) {
                  prompt = `[Context: File "${uploadedFile.name}" (${(uploadedFile.size / 1024).toFixed(1)} KB) is loaded`;
                  if (analysisResult) {
                    prompt += ` | Manufacturability: ${analysisResult.manufacturability}% | Cost: $${analysisResult.cost.total} | Faces: ${analysisResult.geometry.faces}`;
                  }
                  prompt += `]\n\n${action.prompt}`;
                }
                onAction(prompt);
              }}
              disabled={isDisabled}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                isDisabled
                  ? 'border-border/50 text-muted-foreground/40 cursor-not-allowed'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              <action.icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{action.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
