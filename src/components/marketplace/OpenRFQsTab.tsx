import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Filter, Clock, DollarSign, Layers, Award, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { useMarketplace } from '@/hooks/useMarketplace';
import type { RFQ, CreateRFQRequest } from '@/lib/marketplace';

interface Props {
  marketplace: ReturnType<typeof useMarketplace>;
}

const statusColors: Record<string, string> = {
  open: 'bg-accent/15 text-accent border-accent/30',
  evaluating: 'bg-primary/15 text-primary border-primary/30',
  awarded: 'bg-warning/15 text-warning border-warning/30',
  closed: 'bg-muted text-muted-foreground border-border',
  cancelled: 'bg-destructive/15 text-destructive border-destructive/30',
  draft: 'bg-muted text-muted-foreground border-border',
};

export function OpenRFQsTab({ marketplace }: Props) {
  const { rfqs, loading, selectRFQ, activeRFQ, quotes, matchSuppliers, rankQuotes, awardQuote, createRFQ } = marketplace;
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = rfqs.filter(
    (r) =>
      r.title.toLowerCase().includes(search.toLowerCase()) ||
      r.material.toLowerCase().includes(search.toLowerCase()) ||
      r.process.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-[calc(100vh-7rem)]">
      {/* RFQ List */}
      <div className="w-96 border-r border-border flex flex-col shrink-0">
        <div className="p-4 space-y-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search RFQs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-xs bg-secondary border-border"
              />
            </div>
            <CreateRFQDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={createRFQ} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 space-y-1">
          {loading && rfqs.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          )}
          {filtered.map((rfq) => (
            <RFQRow
              key={rfq.id}
              rfq={rfq}
              active={activeRFQ?.id === rfq.id}
              onSelect={() => selectRFQ(rfq.id)}
            />
          ))}
          {!loading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-12">No RFQs found</p>
          )}
        </div>
      </div>

      {/* RFQ Detail */}
      <div className="flex-1 overflow-y-auto">
        {activeRFQ ? (
          <RFQDetail
            rfq={activeRFQ}
            quotes={quotes}
            loading={loading}
            onMatch={() => matchSuppliers(activeRFQ.id)}
            onRank={() => rankQuotes(activeRFQ.id)}
            onAward={(quoteId) => awardQuote(activeRFQ.id, quoteId)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Select an RFQ to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RFQRow({ rfq, active, onSelect }: { rfq: RFQ; active: boolean; onSelect: () => void }) {
  return (
    <motion.button
      whileHover={{ x: 2 }}
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 mx-2 rounded-md transition-colors ${
        active ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{rfq.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono text-muted-foreground">{rfq.material}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs font-mono text-muted-foreground">{rfq.process}</span>
          </div>
        </div>
        <Badge variant="outline" className={`text-[10px] shrink-0 ${statusColors[rfq.status] ?? ''}`}>
          {rfq.status}
        </Badge>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> Qty {rfq.quantity}</span>
        {rfq.targetCostUsd && (
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${rfq.targetCostUsd}</span>
        )}
        {rfq.maxLeadTimeDays && (
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {rfq.maxLeadTimeDays}d</span>
        )}
      </div>
    </motion.button>
  );
}

function RFQDetail({
  rfq,
  quotes,
  loading,
  onMatch,
  onRank,
  onAward,
}: {
  rfq: RFQ;
  quotes: ReturnType<typeof useMarketplace>['quotes'];
  loading: boolean;
  onMatch: () => void;
  onRank: () => void;
  onAward: (quoteId: string) => void;
}) {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{rfq.title}</h2>
          <Badge variant="outline" className={statusColors[rfq.status] ?? ''}>{rfq.status}</Badge>
        </div>
        {rfq.description && <p className="text-sm text-muted-foreground mt-1">{rfq.description}</p>}
      </div>

      {/* Specs grid */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Part', value: rfq.partName },
          { label: 'Material', value: rfq.material },
          { label: 'Process', value: rfq.process },
          { label: 'Quantity', value: rfq.quantity.toLocaleString() },
          { label: 'Complexity', value: `${(rfq.complexityScore * 100).toFixed(0)}%` },
          { label: 'Target Cost', value: rfq.targetCostUsd ? `$${rfq.targetCostUsd}` : '—' },
          { label: 'Max Lead Time', value: rfq.maxLeadTimeDays ? `${rfq.maxLeadTimeDays} days` : '—' },
          { label: 'Region', value: rfq.region ?? '—' },
          { label: 'Certifications', value: rfq.requiredCertifications.length > 0 ? rfq.requiredCertifications.join(', ') : '—' },
        ].map((item) => (
          <div key={item.label} className="bg-card border border-border rounded-md p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
            <p className="text-sm font-mono text-foreground mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      {rfq.status === 'open' && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={onMatch} disabled={loading}>
            <Filter className="w-3.5 h-3.5 mr-1.5" /> Match Suppliers
          </Button>
          <Button size="sm" variant="outline" onClick={onRank} disabled={loading || quotes.length === 0}>
            <Award className="w-3.5 h-3.5 mr-1.5" /> Rank Quotes
          </Button>
        </div>
      )}

      {/* Quotes */}
      {quotes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quotes ({quotes.length})
          </h3>
          <div className="space-y-2">
            {quotes.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between bg-card border border-border rounded-md p-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-semibold text-foreground">
                      ${q.unitPriceUsd.toFixed(2)}/unit
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Total: ${q.totalPriceUsd.toFixed(2)}
                    </span>
                    {q.rank != null && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                        Rank #{q.rank}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {q.leadTimeDays}d</span>
                    <span>Confidence: {(q.confidence * 100).toFixed(0)}%</span>
                    {q.score != null && <span>Score: {q.score.toFixed(1)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusColors[q.status] ?? ''}>{q.status}</Badge>
                  {rfq.status === 'evaluating' && q.status === 'submitted' && (
                    <Button size="sm" variant="default" onClick={() => onAward(q.id)}>
                      <Award className="w-3.5 h-3.5 mr-1" /> Award
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateRFQDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (req: CreateRFQRequest) => Promise<any>;
}) {
  const [form, setForm] = useState<CreateRFQRequest>({
    title: '',
    partName: '',
    material: 'Aluminum 6061',
    process: 'CNC Milling',
    quantity: 100,
  });

  const handleSubmit = async () => {
    if (!form.title || !form.partName) return;
    await onSubmit(form);
    onOpenChange(false);
    setForm({ title: '', partName: '', material: 'Aluminum 6061', process: 'CNC Milling', quantity: 100 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> New RFQ
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create RFQ</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {[
            { label: 'Title', key: 'title', type: 'text' },
            { label: 'Part Name', key: 'partName', type: 'text' },
            { label: 'Material', key: 'material', type: 'text' },
            { label: 'Process', key: 'process', type: 'text' },
            { label: 'Quantity', key: 'quantity', type: 'number' },
          ].map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{field.label}</Label>
              <Input
                type={field.type}
                value={(form as any)[field.key]}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
                className="h-9 text-sm bg-secondary border-border"
              />
            </div>
          ))}
          <Button onClick={handleSubmit} className="w-full">Create RFQ</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
