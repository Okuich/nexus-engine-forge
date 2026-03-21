/**
 * Marketplace Support Tools — Registry
 *
 * Defines tool metadata for LLM tool-calling integration.
 * Each tool has a name, description, and typed parameters.
 */

import type { MarketplaceToolDef } from './types';

export const MARKETPLACE_TOOL_DEFS: MarketplaceToolDef[] = [
  {
    name: 'check_order',
    description: 'Look up an order by ID and return its current status, pricing, and payment state.',
    parameters: [
      { name: 'orderId', type: 'string', required: true, description: 'The marketplace order UUID' },
    ],
  },
  {
    name: 'recompute_quote',
    description: 'Recalculate a quote for an RFQ, applying current pricing rules and supplier rates.',
    parameters: [
      { name: 'rfqId', type: 'string', required: true, description: 'The RFQ UUID to recompute' },
      { name: 'supplierId', type: 'string', required: false, description: 'Specific supplier (uses best match if omitted)' },
      { name: 'quantity', type: 'number', required: false, description: 'Override quantity (uses RFQ quantity if omitted)' },
    ],
  },
  {
    name: 'refund',
    description: 'Process a full or partial refund for an order, adjusting platform fees and supplier payouts.',
    parameters: [
      { name: 'orderId', type: 'string', required: true, description: 'The order UUID to refund' },
      { name: 'reason', type: 'string', required: true, description: 'Reason for the refund' },
      { name: 'amountUsd', type: 'number', required: false, description: 'Partial refund amount (full refund if omitted)' },
    ],
  },
  {
    name: 'escalate',
    description: 'Create a support escalation ticket for an issue that requires human intervention.',
    parameters: [
      { name: 'orderId', type: 'string', required: false, description: 'Related order UUID (if applicable)' },
      { name: 'issueType', type: 'string', required: true, description: 'Category: quality, delivery, pricing, dispute, other' },
      { name: 'description', type: 'string', required: true, description: 'Detailed description of the issue' },
      { name: 'priority', type: 'string', required: true, description: 'Priority: low, medium, high, critical' },
    ],
  },
];

/**
 * Convert tool definitions to OpenAI-compatible tool calling format.
 */
export function toOpenAITools() {
  return MARKETPLACE_TOOL_DEFS.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          def.parameters.map((p) => [p.name, { type: p.type, description: p.description }]),
        ),
        required: def.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}
