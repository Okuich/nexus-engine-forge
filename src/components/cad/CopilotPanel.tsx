import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAppStore } from '@/store/appStore';
import { streamAgentChat, type StreamEvent } from '@/lib/agents/client';
import { AgentActivityBadge } from './copilot/AgentActivityBadge';
import { ActionButtons } from './copilot/ActionButtons';
import { FileContextBar } from './copilot/FileContextBar';

const SUGGESTIONS = [
  'Full geometry analysis',
  'Check manufacturability',
  'Estimate production cost',
  'Run stress analysis',
];

export function CopilotPanel() {
  const { chatMessages, addMessage } = useAppStore();
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
        onDelta: (t) => updateAssistant(t),
        onDone: () => setIsStreaming(false),
      });
    } catch (e) {
      console.error('Agent stream error:', e);
      addMessage({ role: 'assistant', content: '❌ Connection error. Please try again.' });
      setIsStreaming(false);
    }
  }, [input, isStreaming, addMessage]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Midwater AI</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={isStreaming ? 'status-dot-warning' : 'status-dot-online'} />
            <span className="text-[10px] text-muted-foreground font-mono">
              {isStreaming ? 'Processing...' : 'Online'}
            </span>
          </div>
        </div>
      </div>

      {/* File context */}
      <FileContextBar />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {chatMessages.length === 0 && !isStreaming && (
          <div className="text-center py-8">
            <Sparkles className="w-8 h-8 text-primary/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Upload a CAD file and ask me anything about it.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Or use the quick actions below.</p>
          </div>
        )}

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
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1 [&_code]:rounded">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
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

        {isStreaming && (
          <div className="flex items-center gap-2 px-3 py-1">
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">Agents working...</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!isStreaming && <ActionButtons onAction={handleSend} disabled={isStreaming} />}

      {/* Suggestions */}
      {!isStreaming && chatMessages.length === 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
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
      <div className="p-3 border-t border-border shrink-0">
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
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
