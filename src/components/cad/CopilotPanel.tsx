import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, Sparkles, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { streamAgentChat, type StreamEvent } from '@/lib/agents/client';
import { AGENT_INFO, type AgentType } from '@/lib/agents/types';

const suggestions = [
  'Full geometry analysis',
  'Check manufacturability',
  'Estimate production cost',
  'Run stress analysis',
];

function AgentActivityBadge({ event }: { event: StreamEvent }) {
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

export function CopilotPanel() {
  const { copilotOpen, toggleCopilot, chatMessages, addMessage } = useAppStore();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [agentEvents, setAgentEvents] = useState<StreamEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, agentEvents]);

  const handleSend = useCallback(async (text?: string) => {
    const message = text || input.trim();
    if (!message || isStreaming) return;
    setInput('');
    setAgentEvents([]);

    addMessage({ role: 'user', content: message });
    setIsStreaming(true);

    const allMessages = [
      ...useAppStore.getState().chatMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    let assistantText = '';

    const updateAssistant = (chunk: string) => {
      assistantText += chunk;
      const store = useAppStore.getState();
      const msgs = store.chatMessages;
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        // Update in place via store
        useAppStore.setState({
          chatMessages: msgs.map((m, i) =>
            i === msgs.length - 1 ? { ...m, content: assistantText } : m
          ),
        });
      } else {
        addMessage({ role: 'assistant', content: assistantText });
      }
    };

    try {
      await streamAgentChat({
        messages: allMessages,
        onEvent: (event) => {
          setAgentEvents((prev) => [...prev, event]);
          if (event.type === 'error') {
            addMessage({ role: 'assistant', content: `❌ ${event.content}` });
          }
        },
        onDelta: (text) => updateAssistant(text),
        onDone: () => setIsStreaming(false),
      });
    } catch (e) {
      console.error('Agent stream error:', e);
      addMessage({
        role: 'assistant',
        content: '❌ Connection error. Please try again.',
      });
      setIsStreaming(false);
    }
  }, [input, isStreaming, addMessage]);

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
              <div className={isStreaming ? 'status-dot-warning' : 'status-dot-online'} />
              <span className="text-[10px] text-muted-foreground font-mono">
                {isStreaming ? 'Processing...' : 'Online'}
              </span>
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
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
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

        {/* Agent activity feed */}
        {agentEvents.length > 0 && (
          <div className="space-y-1.5">
            {agentEvents
              .filter((e) => e.type !== 'error')
              .map((event, i) => (
                <AgentActivityBadge key={i} event={event} />
              ))}
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 px-3 py-1">
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">Agents working...</span>
          </div>
        )}
      </div>

      {/* Suggestions */}
      {!isStreaming && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isStreaming ? 'Agents are working...' : 'Ask about your model...'}
            disabled={isStreaming}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
            className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors disabled:opacity-30"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
