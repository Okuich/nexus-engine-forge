import { motion } from 'framer-motion';
import type { StreamEvent } from '@/lib/agents/client';
import { AGENT_REGISTRY, type AgentType } from '@/lib/agents/types';

const AGENT_INFO = Object.fromEntries(
  Object.entries(AGENT_REGISTRY).map(([k, v]) => [k, { name: v.name, description: v.description, icon: v.icon }])
) as Record<AgentType, { name: string; description: string; icon: string }>;

export function AgentActivityBadge({ event }: { event: StreamEvent }) {
  const agentType = event.agent as AgentType | undefined;
  const info = agentType ? AGENT_INFO[agentType] : null;

  const bgClass =
    event.type === 'step_complete' ? 'bg-accent/10 border-accent/30' :
    event.type === 'step_error' ? 'bg-destructive/10 border-destructive/30' :
    'bg-primary/10 border-primary/30';

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className={`rounded-lg border px-3 py-1.5 text-[11px] font-mono ${bgClass}`}
    >
      <span>{info?.icon || '⚙️'} </span>
      <span className="text-muted-foreground">{event.content}</span>
    </motion.div>
  );
}
