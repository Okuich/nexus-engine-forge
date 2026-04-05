/**
 * Supplier Match Results — Ranked list with score breakdowns and trust tier badges.
 *
 * Usage:
 *   <SupplierMatchResults suppliers={matchOutput.suppliers} weights={matchOutput.weightsUsed} />
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ScoredSupplier, MatchWeights } from '@/services/supplierMatcher';
import {
  Award, DollarSign, Gauge, Shield, ChevronDown, ChevronUp,
  Trophy, Medal, Star, Clock, Wrench,
} from 'lucide-react';
import { useState } from 'react';

// ─── Trust Tier Config ──────────────────────────────────────────

const TIER_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  gold: { label: 'Gold', icon: Trophy, className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  silver: { label: 'Silver', icon: Medal, className: 'bg-slate-300/10 text-slate-300 border-slate-400/30' },
  bronze: { label: 'Bronze', icon: Star, className: 'bg-orange-600/15 text-orange-400 border-orange-600/30' },
};

// ─── Score Bar ──────────────────────────────────────────────────

function ScoreBar({ label, value, icon: Icon, color }: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground flex items-center gap-1">
          <Icon className="h-3 w-3" />{label}
        </span>
        <span className="font-mono font-medium text-foreground">{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

// ─── Supplier Card ──────────────────────────────────────────────

function SupplierCard({ supplier, isTop }: { supplier: ScoredSupplier; isTop: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const tier = supplier.trustTier ? TIER_CONFIG[supplier.trustTier] : null;

  return (
    <Card className={`transition-all duration-200 ${
      isTop ? 'border-primary/40 shadow-[0_0_20px_-6px_hsl(var(--primary)/0.15)]' : ''
    }`}>
      <CardContent className="p-0">
        {/* Main row */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/20 transition-colors rounded-lg"
        >
          {/* Rank badge */}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
            supplier.rank === 1
              ? 'bg-primary/20 text-primary'
              : supplier.rank <= 3
              ? 'bg-accent/15 text-accent'
              : 'bg-secondary text-muted-foreground'
          }`}>
            {supplier.rank}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground truncate">{supplier.companyName}</p>
              {tier && (
                <Badge variant="outline" className={`text-[10px] h-5 gap-1 ${tier.className}`}>
                  <tier.icon className="h-2.5 w-2.5" />
                  {tier.label}
                </Badge>
              )}
              {isTop && (
                <Badge className="text-[10px] h-5 bg-primary/20 text-primary border-0">
                  Best Match
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />${supplier.estimatedUnitCost.toFixed(2)}/unit
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />{supplier.estimatedLeadDays}d lead
              </span>
            </div>
          </div>

          {/* Total score */}
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-foreground font-mono">{supplier.totalScore.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">/ 100</p>
          </div>

          {/* Expand toggle */}
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="px-3 pb-3 pt-0 border-t border-border mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pt-3">
              {/* Score breakdown */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Score Breakdown</p>
                <ScoreBar label="Capability" value={supplier.scores.capability} icon={Wrench} color="bg-primary" />
                <ScoreBar label="Price" value={supplier.scores.price} icon={DollarSign} color="bg-accent" />
                <ScoreBar label="Performance" value={supplier.scores.performance} icon={Gauge} color="bg-amber-500" />
              </div>

              {/* Match reasons */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Match Reasons</p>
                <ul className="space-y-1">
                  {supplier.reasons.slice(0, 8).map((reason, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                  {supplier.reasons.length > 8 && (
                    <li className="text-[11px] text-muted-foreground/60 italic">
                      +{supplier.reasons.length - 8} more
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Weight Indicator ───────────────────────────────────────────

function WeightPills({ weights }: { weights: MatchWeights }) {
  const items = [
    { label: 'Capability', value: weights.capability, color: 'bg-primary/20 text-primary' },
    { label: 'Price', value: weights.price, color: 'bg-accent/20 text-accent' },
    { label: 'Performance', value: weights.performance, color: 'bg-amber-500/20 text-amber-400' },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground mr-1">Weights:</span>
      {items.map(item => (
        <Tooltip key={item.label}>
          <TooltipTrigger>
            <Badge variant="secondary" className={`text-[10px] h-5 ${item.color} border-0`}>
              {item.label} {(item.value * 100).toFixed(0)}%
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {item.label} weighted at {(item.value * 100).toFixed(0)}% of total score
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────

interface SupplierMatchResultsProps {
  suppliers: ScoredSupplier[];
  weights?: MatchWeights;
  totalCandidates?: number;
  totalDisqualified?: number;
  className?: string;
}

export function SupplierMatchResults({
  suppliers,
  weights,
  totalCandidates,
  totalDisqualified,
  className = '',
}: SupplierMatchResultsProps) {
  if (suppliers.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="py-10 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground">No Matching Suppliers</p>
          <p className="text-xs text-muted-foreground mt-1">
            No suppliers met the requirements. Try relaxing filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            {suppliers.length} Supplier{suppliers.length !== 1 ? 's' : ''} Matched
          </h3>
          {totalCandidates != null && totalDisqualified != null && (
            <span className="text-[10px] text-muted-foreground">
              ({totalDisqualified} disqualified of {totalCandidates})
            </span>
          )}
        </div>
        {weights && <WeightPills weights={weights} />}
      </div>

      {/* Supplier cards */}
      <div className="space-y-2">
        {suppliers.map((s, i) => (
          <SupplierCard key={s.supplierId} supplier={s} isTop={i === 0} />
        ))}
      </div>
    </div>
  );
}
