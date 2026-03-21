/**
 * Agent Orchestrator Client — streams events from the multi-agent system.
 * Handles SSE parsing, error recovery, and typed event dispatch.
 */
import type { AgentType } from './types';

const AGENT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`;

export interface StreamEvent {
  type: 'planning' | 'plan_ready' | 'validation' | 'output_validation' | 'step_start' | 'step_complete' | 'step_error'
    | 'step_retry' | 'cache_hit' | 'parallel_group' | 'memory_store' | 'consistency_check'
    | 'confidence_report' | 'token' | 'done' | 'error';
  agent?: AgentType | string;
  tool?: string;
  stepId?: string;
  content?: string;
  data?: Record<string, unknown>;
  parallelGroup?: number;
  cached?: boolean;
  confidence?: number;
}

export interface StreamChatOptions {
  messages: { role: string; content: string }[];
  context?: {
    tenantId?: string;
    modelId?: string;
    material?: string;
  };
  onEvent: (event: StreamEvent) => void;
  onDelta: (text: string) => void;
  onDone: () => void;
  signal?: AbortSignal;
}

export async function streamAgentChat({
  messages,
  context,
  onEvent,
  onDelta,
  onDone,
  signal,
}: StreamChatOptions) {
  const resp = await fetch(AGENT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages, context }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    if (resp.status === 429) {
      onEvent({ type: 'error', content: 'Rate limit exceeded. Please try again in a moment.' });
      onDone();
      return;
    }
    if (resp.status === 402) {
      onEvent({ type: 'error', content: 'AI credits exhausted. Add funds in Settings → Workspace → Usage.' });
      onDone();
      return;
    }
    throw new Error(`Agent request failed: ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.startsWith(':') || line.trim() === '') continue;
      if (!line.startsWith('data: ')) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') { onDone(); return; }

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.event) {
          onEvent(parsed as StreamEvent);
          continue;
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buffer = line + '\n' + buffer;
        break;
      }
    }
  }

  // Flush remaining
  if (buffer.trim()) {
    for (let raw of buffer.split('\n')) {
      if (!raw) continue;
      if (raw.endsWith('\r')) raw = raw.slice(0, -1);
      if (!raw.startsWith('data: ')) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.event) onEvent(parsed as StreamEvent);
        else {
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        }
      } catch { /* ignore */ }
    }
  }

  onDone();
}
