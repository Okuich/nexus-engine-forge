import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, AlertTriangle, AlertCircle, Info, TrendingUp, DollarSign, Box,
  Zap, ChevronRight, ChevronDown, Sparkles, Loader2, FileText, Download,
  CheckCircle2, HelpCircle, Sliders, Target, Lightbulb, Clock, ArrowRight,
} from 'lucide-react';
import { useAppStore, type RiskItem, type Recommendation } from '@/store/appStore';
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { generateQuotePdf } from '@/lib/generateQuotePdf';

// ─── Animated Score ─────────────────────────────────────────────

function AnimatedScore({ value, label, delay = 0 }: { value: number; label: string; delay?: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const duration = 1200;
      const startTime = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayed(Math.round(value * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  const color = value >= 80 ? 'text-accent' : value >= 60 ? 'text-primary' : value >= 40 ? 'text-warning' : 'text-destructive';
  const ringColor = value >= 80 ? 'stroke-accent' : value >= 60 ? 'stroke-primary' : value >= 40 ? 'stroke-warning' : 'stroke-destructive';
  const circumference = 2 * Math.PI * 44;
  const strokeDashoffset = circumference - (displayed / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" className="stroke-secondary" strokeWidth="6" />
          <motion.circle cx="50" cy="50" r="44" fill="none" className={ringColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset }} transition={{ duration: 1.2, delay: delay / 1000, ease: 'easeOut' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold font-mono ${color}`}>{displayed}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">/100</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground mt-2 font-medium">{label}</span>
    </div>
  );
}

// ─── Cost Row ───────────────────────────────────────────────────

function CostRow({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: delay / 1000 }} className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground">${value.toLocaleString()}</span>
    </motion.div>
  );
}

// ─── Risk Card ──────────────────────────────────────────────────

const severityConfig = {
  critical: { icon: AlertCircle, className: 'border-destructive/30 bg-destructive/5', iconClass: 'text-destructive', badge: 'bg-destructive/20 text-destructive' },
  high: { icon: AlertTriangle, className: 'border-warning/30 bg-warning/5', iconClass: 'text-warning', badge: 'bg-warning/20 text-warning' },
  medium: { icon: AlertTriangle, className: 'border-primary/30 bg-primary/5', iconClass: 'text-primary', badge: 'bg-primary/20 text-primary' },
  low: { icon: Info, className: 'border-accent/30 bg-accent/5', iconClass: 'text-accent', badge: 'bg-accent/20 text-accent' },
};

function RiskCard({ risk, index }: { risk: RiskItem; index: number }) {
  const cfg = severityConfig[risk.severity];
  const Icon = cfg.icon;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + index * 0.1 }} className={`rounded-xl border p-3 ${cfg.className}`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground">{risk.title}</span>
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md ${cfg.badge}`}>{risk.severity}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{risk.description}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Collapsible "Why?" Section ─────────────────────────────────

function WhySection({ title, icon: Icon, items }: { title: string; icon: React.ElementType; items: string[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors">
        <HelpCircle className="w-3 h-3" />
        <span>Why?</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 rounded-lg bg-secondary/30 border border-border p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Icon className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
              </div>
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-primary text-xs mt-0.5">•</span>
                  <span className="text-xs text-muted-foreground leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Analyzing State ────────────────────────────────────────────

function AnalyzingState() {
  const analysisProgress = useAppStore((s) => s.analysisProgress);
  const steps = [
    { key: 'uploading', label: 'File uploaded' },
    { key: 'parsing', label: 'Parsing geometry mesh...' },
    { key: 'analyzing', label: 'Extracting features & running GNN...' },
    { key: 'estimating', label: 'Computing cost estimate...' },
    { key: 'generating', label: 'Generating report...' },
  ];

  const completedSet = new Set(analysisProgress?.stepsCompleted ?? []);
  const current = analysisProgress?.currentStep;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }} className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <Zap className="w-6 h-6 text-primary" />
      </motion.div>
      <p className="text-sm font-medium text-foreground mb-4">Analyzing Part</p>
      <div className="space-y-2 w-full max-w-[260px]">
        {steps.map((s) => {
          const done = completedSet.has(s.key as any);
          const active = current === s.key;
          return (
            <motion.div key={s.key} initial={{ opacity: 0.3 }} animate={{ opacity: done || active ? 1 : 0.3 }} className="flex items-center gap-2">
              {done ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                  <span className="text-[8px] text-accent-foreground font-bold">✓</span>
                </motion.div>
              ) : active ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-border" />
              )}
              <span className="text-xs text-muted-foreground font-mono">{s.label}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Human-in-the-loop Controls ─────────────────────────────────

function CostAdjustmentPanel() {
  const { costOverrides, setCostOverrides } = useAppStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="px-5 py-3 border-b border-border">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left">
        <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex-1">Adjust Assumptions</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs text-muted-foreground">Material Cost ($/kg)</Label>
                  <span className="text-xs font-mono text-foreground">${costOverrides.materialCostPerKg}</span>
                </div>
                <Slider
                  value={[costOverrides.materialCostPerKg]}
                  onValueChange={([v]) => setCostOverrides({ materialCostPerKg: v })}
                  min={40}
                  max={300}
                  step={5}
                  className="w-full"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs text-muted-foreground">Machining Rate ($/hr)</Label>
                  <span className="text-xs font-mono text-foreground">${costOverrides.machiningRatePerHr}</span>
                </div>
                <Slider
                  value={[costOverrides.machiningRatePerHr]}
                  onValueChange={([v]) => setCostOverrides({ machiningRatePerHr: v })}
                  min={30}
                  max={200}
                  step={5}
                  className="w-full"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Tolerance Level</Label>
                <Select
                  value={costOverrides.toleranceLevel}
                  onValueChange={(v) => setCostOverrides({ toleranceLevel: v as any })}
                >
                  <SelectTrigger className="h-8 bg-secondary/50 border-border text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard (+-0.1mm)</SelectItem>
                    <SelectItem value="precision">Precision (+-0.025mm)</SelectItem>
                    <SelectItem value="ultra-precision">Ultra-Precision (+-0.005mm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ROI Display ────────────────────────────────────────────────

function ROISection({ cost }: { cost: number }) {
  const manualQuoteHrs = 2.5;
  const aiQuoteMin = 0.2;
  const hoursSaved = manualQuoteHrs - aiQuoteMin;
  const costReductionLow = 12;
  const costReductionHigh = 25;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-semibold uppercase tracking-widest text-accent">Estimated Value</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="w-3 h-3 text-accent" />
            <span className="text-[10px] text-muted-foreground">Time Saved</span>
          </div>
          <span className="text-lg font-bold font-mono text-accent">{hoursSaved.toFixed(1)}h</span>
          <p className="text-[9px] text-muted-foreground">per quote vs manual</p>
        </div>
        <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3 text-accent" />
            <span className="text-[10px] text-muted-foreground">Cost Reduction</span>
          </div>
          <span className="text-lg font-bold font-mono text-accent">{costReductionLow}-{costReductionHigh}%</span>
          <p className="text-[9px] text-muted-foreground">optimization potential</p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Optimization Highlight ─────────────────────────────────────

function OptimizationHighlight() {
  const { optimizationResult, baseAnalysisResult, analysisResult } = useAppStore();
  if (!optimizationResult || !baseAnalysisResult || !analysisResult) return null;

  const originalCost = baseAnalysisResult.cost.total;
  const optimizedCost = analysisResult.cost.total;
  const savings = originalCost - optimizedCost;
  const savingsPct = Math.round((savings / originalCost) * 100);

  if (savings <= 0) return null;

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, type: 'spring' }} className="mx-5 mt-4 rounded-xl border-2 border-accent/40 bg-accent/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-accent" />
        <span className="text-sm font-bold text-accent">Optimization Result</span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Original cost</span>
          <span className="text-sm font-mono text-muted-foreground line-through">${originalCost.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-foreground font-medium">Optimized cost</span>
          <span className="text-sm font-mono font-bold text-accent">${optimizedCost.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-accent/20">
          <span className="text-xs font-semibold text-accent">Savings</span>
          <span className="text-sm font-mono font-bold text-accent">${savings.toLocaleString()} ({savingsPct}%)</span>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Recommendations Section ────────────────────────────────────

function RecommendationsSection({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) return null;

  const priorityConfig = {
    high: { bg: 'bg-destructive/5 border-destructive/20', dot: 'bg-destructive' },
    medium: { bg: 'bg-primary/5 border-primary/20', dot: 'bg-primary' },
    low: { bg: 'bg-accent/5 border-accent/20', dot: 'bg-accent' },
  };

  return (
    <div className="px-5 py-4 border-b border-border">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recommended Actions</span>
      </div>
      <div className="space-y-2">
        {recommendations.map((rec, i) => {
          const cfg = priorityConfig[rec.priority];
          return (
            <motion.div key={rec.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.1 }} className={`rounded-lg border p-3 ${cfg.bg}`}>
              <div className="flex items-start gap-2">
                <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${cfg.dot}`} />
                <div>
                  <p className="text-xs font-medium text-foreground leading-relaxed">{rec.action}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <ArrowRight className="w-2.5 h-2.5" />
                    {rec.impact}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error Banner ───────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mx-5 mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <p className="text-xs text-warning leading-relaxed">{message}</p>
    </motion.div>
  );
}

// ─── Quote Dialog ───────────────────────────────────────────────

function QuoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { analysisResult, uploadedFile, recommendations } = useAppStore();
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [submitted, setSubmitted] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = () => {
    if (!analysisResult) return;
    setGenerating(true);
    setTimeout(() => {
      generateQuotePdf({
        analysis: analysisResult,
        fileName: uploadedFile?.name || 'Unknown_Part',
        email,
        company,
        quantity: Math.max(1, parseInt(quantity) || 1),
        totalCost,
        volumeDiscount,
        recommendations,
      });
      setGenerating(false);
      setSubmitted(true);
    }, 1200);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => { setSubmitted(false); setGenerating(false); }, 300);
  };

  if (!analysisResult) return null;

  const unitCost = analysisResult.cost.total;
  const qty = Math.max(1, parseInt(quantity) || 1);
  const volumeDiscount = qty >= 100 ? 0.72 : qty >= 50 ? 0.78 : qty >= 25 ? 0.84 : qty >= 10 ? 0.90 : qty >= 5 ? 0.95 : 1;
  const totalCost = Math.round(unitCost * qty * volumeDiscount);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Generate Manufacturing Quote
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {submitted ? (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-8 flex flex-col items-center text-center">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-7 h-7 text-accent" />
              </motion.div>
              <h3 className="text-base font-semibold text-foreground mb-1">Quote Generated</h3>
              <p className="text-sm text-muted-foreground mb-5">Your PDF quote is ready to download.</p>
              <div className="w-full rounded-xl bg-secondary/50 border border-border p-4 mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-mono">{uploadedFile?.name}</span>
                  <span className="text-xs font-mono text-primary">{qty} unit{qty > 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Quote</span>
                  <span className="text-xl font-bold font-mono text-primary">${totalCost.toLocaleString()}</span>
                </div>
              </div>
              <Button onClick={() => {
                if (analysisResult) {
                  generateQuotePdf({ analysis: analysisResult, fileName: uploadedFile?.name || 'Unknown_Part', email, company, quantity: qty, totalCost, volumeDiscount, recommendations });
                }
                handleClose();
              }} className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Quote PDF
              </Button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4 py-2">
              <div className="rounded-xl bg-secondary/30 border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-muted-foreground">{uploadedFile?.name}</span>
                  <span className={`text-xs font-mono font-semibold ${analysisResult.manufacturability >= 80 ? 'text-accent' : 'text-primary'}`}>Score: {analysisResult.manufacturability}/100</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: analysisResult.cost.material, l: 'Material' },
                    { v: analysisResult.cost.machining, l: 'Machining' },
                    { v: analysisResult.cost.tooling, l: 'Tooling' },
                  ].map((c) => (
                    <div key={c.l} className="text-center py-1.5 rounded-lg bg-background/50">
                      <div className="text-sm font-bold font-mono text-foreground">${c.v}</div>
                      <div className="text-[9px] text-muted-foreground">{c.l}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono text-muted-foreground">Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="bg-secondary border-border text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono text-muted-foreground">Company</Label>
                  <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" className="bg-secondary border-border text-sm" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-mono text-muted-foreground">Quantity</Label>
                <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-secondary border-border text-sm font-mono w-32" />
                {volumeDiscount < 1 && (
                  <p className="text-[10px] text-accent font-mono">Volume discount: {Math.round((1 - volumeDiscount) * 100)}% off -- ${totalCost.toLocaleString()} total</p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div>
                  <span className="text-xs text-muted-foreground">Estimated total</span>
                  <p className="text-lg font-bold font-mono text-primary">${totalCost.toLocaleString()}</p>
                </div>
                <Button onClick={handleGenerate} disabled={generating} className="gap-2 shadow-lg shadow-primary/20">
                  {generating ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : <><FileText className="h-4 w-4" />Generate Quote</>}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────

export function AnalysisPanel() {
  const {
    demoPhase, analysisResult, runOptimize, uploadedFile,
    explanations, recommendations, analysisError, optimizationResult,
  } = useAppStore();
  const [quoteOpen, setQuoteOpen] = useState(false);

  if (demoPhase === 'idle' || demoPhase === 'uploading') return null;

  return (
    <>
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 380, opacity: 1 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="h-full bg-card border-l border-border flex flex-col shrink-0 overflow-hidden"
      >
        {/* Header */}
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span className="panel-title">Analysis Results</span>
          </div>
          {uploadedFile && (
            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]">{uploadedFile.name}</span>
          )}
        </div>

        {demoPhase === 'analyzing' ? (
          <AnalyzingState />
        ) : analysisResult ? (
          <div className="flex-1 overflow-y-auto">
            {/* Error banner */}
            {analysisError && <ErrorBanner message={analysisError} />}

            {/* Optimization highlight */}
            {demoPhase === 'optimized' && <OptimizationHighlight />}

            {/* Score */}
            <div className="px-6 py-5 border-b border-border">
              <AnimatedScore value={analysisResult.manufacturability} label="Manufacturability" />
              {explanations && (
                <WhySection title="Manufacturability Factors" icon={Shield} items={explanations.manufacturabilityIssues} />
              )}
            </div>

            {/* Cost + Why */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cost Estimate</span>
              </div>
              <CostRow label="Material" value={analysisResult.cost.material} delay={200} />
              <CostRow label="Machining" value={analysisResult.cost.machining} delay={300} />
              <CostRow label="Tooling" value={analysisResult.cost.tooling} delay={400} />
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="flex items-center justify-between pt-2 mt-2 border-t border-border">
                <span className="text-sm font-semibold text-foreground">Total</span>
                <span className="text-lg font-bold font-mono text-primary">${analysisResult.cost.total.toLocaleString()}</span>
              </motion.div>
              {explanations && (
                <WhySection title="Cost Drivers" icon={DollarSign} items={explanations.costDrivers} />
              )}
            </div>

            {/* Human-in-the-loop controls */}
            <CostAdjustmentPanel />

            {/* ROI */}
            <ROISection cost={analysisResult.cost.total} />

            {/* Geometry stats */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 mb-3">
                <Box className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Geometry</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Faces', value: analysisResult.geometry.faces },
                  { label: 'Edges', value: analysisResult.geometry.edges },
                  { label: 'Holes', value: analysisResult.geometry.holes },
                ].map((stat, i) => (
                  <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.08 }} className="text-center py-2 rounded-lg bg-secondary/50">
                    <div className="text-lg font-bold font-mono text-foreground">{stat.value}</div>
                    <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                  </motion.div>
                ))}
              </div>
              <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                <span>Min thickness: <span className="text-foreground font-mono">{analysisResult.geometry.minThickness}mm</span></span>
                <span>Vol: <span className="text-foreground font-mono">{analysisResult.geometry.volume}cm3</span></span>
              </div>
            </div>

            {/* Risks + Why */}
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Risks ({analysisResult.risks.length})</span>
              </div>
              <div className="space-y-2">
                {analysisResult.risks.map((risk, i) => <RiskCard key={risk.id} risk={risk} index={i} />)}
                {analysisResult.risks.length === 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4 text-sm text-accent">No significant risks detected</motion.div>
                )}
              </div>
              {explanations && explanations.riskFactors.length > 0 && (
                <WhySection title="Risk Analysis" icon={AlertTriangle} items={explanations.riskFactors} />
              )}
            </div>

            {/* Recommendations */}
            <RecommendationsSection recommendations={recommendations} />

            {/* CTAs */}
            <div className="px-5 py-5 space-y-3">
              {demoPhase === 'optimizing' ? (
                <motion.button disabled className="w-full py-3 rounded-xl bg-primary/20 text-primary font-semibold text-sm flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Optimizing geometry...
                </motion.button>
              ) : demoPhase === 'optimized' ? (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="w-full py-3 rounded-xl bg-accent/10 border border-accent/30 text-accent font-semibold text-sm flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Optimized -- Score: {analysisResult.manufacturability}/100
                </motion.div>
              ) : (
                <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={runOptimize} className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-shadow">
                  <TrendingUp className="w-4 h-4" />
                  Optimize Part
                  <ChevronRight className="w-4 h-4" />
                </motion.button>
              )}

              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.15 }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setQuoteOpen(true)} className="w-full py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-accent/20 hover:shadow-xl hover:shadow-accent/30 transition-shadow">
                <FileText className="w-4 h-4" />
                Generate Quote
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            </div>
          </div>
        ) : null}
      </motion.div>

      <QuoteDialog open={quoteOpen} onOpenChange={setQuoteOpen} />
    </>
  );
}
