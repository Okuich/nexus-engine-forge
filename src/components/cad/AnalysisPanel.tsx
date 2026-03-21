import { motion, AnimatePresence } from 'framer-motion';
import { Shield, AlertTriangle, AlertCircle, Info, TrendingUp, DollarSign, Box, Zap, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { useAppStore, type RiskItem } from '@/store/appStore';
import { useEffect, useState } from 'react';

function AnimatedScore({ value, label, delay = 0 }: { value: number; label: string; delay?: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      let start = 0;
      const duration = 1200;
      const startTime = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
        setDisplayed(Math.round(start + (value - start) * eased));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);

  const color =
    value >= 80 ? 'text-accent' :
    value >= 60 ? 'text-primary' :
    value >= 40 ? 'hsl(var(--warning))' : 'text-destructive';

  const ringColor =
    value >= 80 ? 'stroke-accent' :
    value >= 60 ? 'stroke-primary' :
    value >= 40 ? 'stroke-warning' : 'stroke-destructive';

  const circumference = 2 * Math.PI * 44;
  const strokeDashoffset = circumference - (displayed / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="44" fill="none" className="stroke-secondary" strokeWidth="6" />
          <motion.circle
            cx="50" cy="50" r="44" fill="none"
            className={ringColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.2, delay: delay / 1000, ease: 'easeOut' }}
          />
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

function CostRow({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: delay / 1000 }}
      className="flex items-center justify-between py-1.5"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground">${value.toLocaleString()}</span>
    </motion.div>
  );
}

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 + index * 0.1 }}
      className={`rounded-xl border p-3 ${cfg.className}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground">{risk.title}</span>
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md ${cfg.badge}`}>
              {risk.severity}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{risk.description}</p>
        </div>
      </div>
    </motion.div>
  );
}

function AnalyzingState() {
  const steps = ['Parsing geometry mesh...', 'Extracting features...', 'Running GNN inference...', 'Computing scores...'];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => Math.min(s + 1, steps.length - 1));
    }, 700);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-6"
      >
        <Zap className="w-6 h-6 text-primary" />
      </motion.div>
      <p className="text-sm font-medium text-foreground mb-4">Analyzing Part</p>
      <div className="space-y-2 w-full max-w-[240px]">
        {steps.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0.3 }}
            animate={{ opacity: i <= step ? 1 : 0.3 }}
            className="flex items-center gap-2"
          >
            {i < step ? (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                <span className="text-[8px] text-accent-foreground font-bold">✓</span>
              </motion.div>
            ) : i === step ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-border" />
            )}
            <span className="text-xs text-muted-foreground font-mono">{s}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function AnalysisPanel() {
  const { demoPhase, analysisResult, runOptimize, uploadedFile } = useAppStore();

  if (demoPhase === 'idle' || demoPhase === 'uploading') return null;

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 360, opacity: 1 }}
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
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">
            {uploadedFile.name}
          </span>
        )}
      </div>

      {demoPhase === 'analyzing' ? (
        <AnalyzingState />
      ) : analysisResult ? (
        <div className="flex-1 overflow-y-auto">
          {/* Score */}
          <div className="px-6 py-5 border-b border-border">
            <AnimatedScore
              value={analysisResult.manufacturability}
              label="Manufacturability"
            />
          </div>

          {/* Cost */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Cost Estimate</span>
            </div>
            <CostRow label="Material" value={analysisResult.cost.material} delay={200} />
            <CostRow label="Machining" value={analysisResult.cost.machining} delay={300} />
            <CostRow label="Tooling" value={analysisResult.cost.tooling} delay={400} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-between pt-2 mt-2 border-t border-border"
            >
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-lg font-bold font-mono text-primary">${analysisResult.cost.total.toLocaleString()}</span>
            </motion.div>
          </div>

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
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + i * 0.08 }}
                  className="text-center py-2 rounded-lg bg-secondary/50"
                >
                  <div className="text-lg font-bold font-mono text-foreground">{stat.value}</div>
                  <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                </motion.div>
              ))}
            </div>
            <div className="flex justify-between mt-3 text-xs text-muted-foreground">
              <span>Min thickness: <span className="text-foreground font-mono">{analysisResult.geometry.minThickness}mm</span></span>
              <span>Vol: <span className="text-foreground font-mono">{analysisResult.geometry.volume}cm³</span></span>
            </div>
          </div>

          {/* Risks */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Risks ({analysisResult.risks.length})
              </span>
            </div>
            <div className="space-y-2">
              {analysisResult.risks.map((risk, i) => (
                <RiskCard key={risk.id} risk={risk} index={i} />
              ))}
              {analysisResult.risks.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-4 text-sm text-accent"
                >
                  ✓ No significant risks detected
                </motion.div>
              )}
            </div>
          </div>

          {/* Optimize CTA */}
          <div className="px-5 py-5">
            {demoPhase === 'optimizing' ? (
              <motion.button
                disabled
                className="w-full py-3 rounded-xl bg-primary/20 text-primary font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                Optimizing geometry...
              </motion.button>
            ) : demoPhase === 'optimized' ? (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full py-3 rounded-xl bg-accent/10 border border-accent/30 text-accent font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Part Optimized — Score: {analysisResult.manufacturability}/100
              </motion.div>
            ) : (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={runOptimize}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-shadow"
              >
                <TrendingUp className="w-4 h-4" />
                Optimize Part
                <ChevronRight className="w-4 h-4" />
              </motion.button>
            )}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
