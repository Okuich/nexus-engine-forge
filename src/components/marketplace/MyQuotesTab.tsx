import { useEffect, useState } from 'react';
import { Clock, DollarSign, Award, TrendingUp, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { useMarketplace } from '@/hooks/useMarketplace';

interface Props {
  marketplace: ReturnType<typeof useMarketplace>;
}

const statusStyles: Record<string, string> = {
  submitted: 'bg-primary/15 text-primary border-primary/30',
  'under-review': 'bg-warning/15 text-warning border-warning/30',
  accepted: 'bg-accent/15 text-accent border-accent/30',
  rejected: 'bg-destructive/15 text-destructive border-destructive/30',
  withdrawn: 'bg-muted text-muted-foreground border-border',
};

export function MyQuotesTab({ marketplace }: Props) {
  const { quotes, loading } = marketplace;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-2">
        <DollarSign className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No quotes submitted yet</p>
        <p className="text-xs text-muted-foreground/70">Select an open RFQ and submit a quote to get started</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        My Submitted Quotes ({quotes.length})
      </h2>

      <div className="space-y-3">
        {quotes.map((q) => (
          <div
            key={q.id}
            className="bg-card border border-border rounded-lg p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-base font-mono font-semibold text-foreground">
                  ${q.unitPriceUsd.toFixed(2)}
                  <span className="text-xs text-muted-foreground font-normal">/unit</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  Total: <span className="font-mono">${q.totalPriceUsd.toFixed(2)}</span>
                </span>
              </div>
              <Badge variant="outline" className={statusStyles[q.status] ?? ''}>
                {q.status}
              </Badge>
            </div>

            <div className="flex items-center gap-5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {q.leadTimeDays} days lead time
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                {(q.confidence * 100).toFixed(0)}% confidence
              </span>
              {q.rank != null && (
                <span className="flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-primary" />
                  Rank #{q.rank}
                </span>
              )}
              {q.score != null && (
                <span className="font-mono">Score: {q.score.toFixed(1)}</span>
              )}
            </div>

            {q.notes && (
              <p className="text-xs text-muted-foreground/80 bg-secondary/50 rounded-md px-3 py-2">
                {q.notes}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
