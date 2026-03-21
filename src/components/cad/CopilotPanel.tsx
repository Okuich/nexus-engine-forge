import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Sparkles, Wrench, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

const suggestions = [
  'Analyze wall thickness',
  'Check draft angles',
  'Suggest toolpath',
  'Material comparison',
];

export function CopilotPanel() {
  const { copilotOpen, toggleCopilot, chatMessages, addMessage } = useAppStore();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = () => {
    if (!input.trim()) return;
    addMessage({ role: 'user', content: input.trim() });
    const userInput = input.trim();
    setInput('');

    // Simulated AI response
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content: getSimulatedResponse(userInput),
      });
    }, 800);
  };

  if (!copilotOpen) {
    return (
      <motion.button
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={toggleCopilot}
        className="absolute right-4 top-4 p-3 rounded-xl bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-shadow"
      >
        <Bot className="w-5 h-5" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 340, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="h-full bg-card border-l border-border flex flex-col shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="panel-title">AI Copilot</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="status-dot-online" />
              <span className="text-[10px] text-muted-foreground font-mono">Online</span>
            </div>
          </div>
        </div>
        <button
          onClick={toggleCopilot}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        <AnimatePresence>
          {chatMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-secondary text-secondary-foreground rounded-bl-sm'
                }`}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Suggestions */}
      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => {
              addMessage({ role: 'user', content: s });
              setTimeout(() => addMessage({ role: 'assistant', content: getSimulatedResponse(s) }), 800);
            }}
            className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask about your model..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function getSimulatedResponse(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes('thickness') || lower.includes('wall'))
    return '⚠️ Wall thickness analysis: Min 1.2mm detected at Section C-7. Recommended minimum for Ti-6Al-4V is 1.5mm. Consider reinforcing ribs at the inlet junction.';
  if (lower.includes('draft'))
    return '✅ Draft angle check passed. All external faces exceed 3° draft. Internal bore shows 1.5° — adequate for investment casting.';
  if (lower.includes('toolpath'))
    return '🔧 Recommended: Adaptive clearing with 0.5mm stepdown, followed by parallel finishing at 0.15mm. Est. cycle time: 4h 23min on 5-axis.';
  if (lower.includes('material'))
    return '📊 Ti-6Al-4V vs Inconel 718:\n• Density: 4.43 vs 8.19 g/cm³\n• Yield: 880 vs 1035 MPa\n• Machinability: Ti wins\n• Temp resistance: Inconel wins above 650°C';
  return `Analyzing "${input}"... Based on the current geometry, I'd recommend reviewing the stress concentration points near the flange-body interface. Want me to run a detailed FEA preview?`;
}
