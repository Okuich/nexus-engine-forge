import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Calculator, TrendingDown, DollarSign, Sparkles,
  ArrowRight, Package, Percent, Clock, ChevronLeft,
} from 'lucide-react';

// ─── Pricing Tier Logic ─────────────────────────────────────────

interface TierFit {
  name: 'Starter' | 'Pro' | 'Enterprise';
  annualFee: number;
  overage: number;
  rationale: string;
}

function recommendTier(parts: number): TierFit {
  if (parts <= 500) {
    return { name: 'Starter', annualFee: 5000, overage: 0, rationale: 'Within 500 analyses / yr' };
  }
  if (parts <= 5000) {
    const overage = Math.max(0, parts - 5000) * 10;
    return { name: 'Pro', annualFee: 15000, overage, rationale: 'Within 5,000 analyses / yr' };
  }
  return { name: 'Enterprise', annualFee: 50000, overage: 0, rationale: 'Unlimited analyses' };
}

// ─── Currency helper ────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// ─── Page ───────────────────────────────────────────────────────

export default function ROICalculator() {
  const [partVolume, setPartVolume] = useState(2_000);
  const [avgPartCost, setAvgPartCost] = useState(250);
  const [savingsPct, setSavingsPct] = useState(15); // 10–25 typical

  const calc = useMemo(() => {
    const currentSpend = partVolume * avgPartCost;
    const grossSavings = currentSpend * (savingsPct / 100);

    const tier = recommendTier(partVolume);
    const platformCost = tier.annualFee + tier.overage;

    // Enterprise performance fee = 2% of verified savings
    const performanceFee = tier.name === 'Enterprise' ? grossSavings * 0.02 : 0;

    const totalPlatformCost = platformCost + performanceFee;
    const netSavings = grossSavings - totalPlatformCost;
    const roiMultiple = totalPlatformCost > 0 ? netSavings / totalPlatformCost : 0;
    const paybackDays = grossSavings > 0 ? (totalPlatformCost / grossSavings) * 365 : 0;

    return {
      currentSpend,
      grossSavings,
      tier,
      platformCost,
      performanceFee,
      totalPlatformCost,
      netSavings,
      roiMultiple,
      paybackDays,
    };
  }, [partVolume, avgPartCost, savingsPct]);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          <Link to="/pricing">
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-3">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to Pricing
            </Button>
          </Link>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Calculator className="h-5 w-5 text-primary" />
            </div>
            <div>
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary mb-1">
                <Sparkles className="h-3 w-3 mr-1" /> ROI Calculator
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
                Estimate your savings with Midwater
              </h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Enter your part volume and current spend. We'll estimate optimization savings,
            recommend a tier, and show your projected ROI.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Inputs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-2 space-y-4"
          >
            <Card>
              <CardContent className="p-6 space-y-6">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" /> Your inputs
                </h2>

                {/* Part volume */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="parts" className="text-xs text-muted-foreground">
                      Part analyses / year
                    </Label>
                    <span className="text-sm font-mono font-bold text-foreground">
                      {partVolume.toLocaleString()}
                    </span>
                  </div>
                  <Input
                    id="parts"
                    type="number"
                    min={0}
                    value={partVolume}
                    onChange={(e) => setPartVolume(Math.max(0, Number(e.target.value) || 0))}
                    className="font-mono"
                  />
                  <Slider
                    value={[partVolume]}
                    onValueChange={([v]) => setPartVolume(v)}
                    min={50}
                    max={50_000}
                    step={50}
                  />
                </div>

                {/* Avg part cost */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="cost" className="text-xs text-muted-foreground">
                      Avg cost per part
                    </Label>
                    <span className="text-sm font-mono font-bold text-foreground">
                      {fmt(avgPartCost)}
                    </span>
                  </div>
                  <Input
                    id="cost"
                    type="number"
                    min={0}
                    value={avgPartCost}
                    onChange={(e) => setAvgPartCost(Math.max(0, Number(e.target.value) || 0))}
                    className="font-mono"
                  />
                  <Slider
                    value={[avgPartCost]}
                    onValueChange={([v]) => setAvgPartCost(v)}
                    min={10}
                    max={5_000}
                    step={10}
                  />
                </div>

                {/* Savings assumption */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">
                      Expected optimization
                    </Label>
                    <span className="text-sm font-mono font-bold text-accent">
                      {savingsPct}%
                    </span>
                  </div>
                  <Slider
                    value={[savingsPct]}
                    onValueChange={([v]) => setSavingsPct(v)}
                    min={5}
                    max={30}
                    step={1}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Typical Midwater customers save 10–25% on manufacturing cost.
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Results */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="lg:col-span-3 space-y-4"
          >
            {/* Headline savings */}
            <Card className="border-accent/30 bg-gradient-to-br from-card via-accent/[0.04] to-card">
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                      Net annual savings
                    </p>
                    <p className="text-4xl font-bold font-mono text-accent tracking-tight">
                      {fmt(Math.max(0, calc.netSavings))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      after platform & performance fees
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                    <TrendingDown className="h-6 w-6 text-accent" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-border">
                  <Stat
                    label="Current spend"
                    value={fmt(calc.currentSpend)}
                    icon={DollarSign}
                  />
                  <Stat
                    label="ROI multiple"
                    value={`${calc.roiMultiple.toFixed(1)}×`}
                    icon={Percent}
                    accent
                  />
                  <Stat
                    label="Payback"
                    value={calc.paybackDays > 0
                      ? `${Math.ceil(calc.paybackDays)} days`
                      : '—'}
                    icon={Clock}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Breakdown */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <h3 className="text-sm font-semibold text-foreground mb-2">Breakdown</h3>

                <Row label="Gross optimization savings" value={fmt(calc.grossSavings)} positive />
                <Row
                  label={`Platform cost (${calc.tier.name})`}
                  value={`− ${fmt(calc.platformCost)}`}
                />
                {calc.performanceFee > 0 && (
                  <Row
                    label="Performance fee (2% of savings)"
                    value={`− ${fmt(calc.performanceFee)}`}
                  />
                )}
                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Net savings</span>
                  <span className="text-base font-mono font-bold text-accent">
                    {fmt(Math.max(0, calc.netSavings))}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Tier recommendation */}
            <Card className="border-primary/20 bg-gradient-to-r from-card via-primary/[0.03] to-card">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Recommended tier</p>
                  <p className="text-base font-bold text-primary">
                    {calc.tier.name}
                    <span className="text-xs text-muted-foreground font-normal ml-2">
                      · {calc.tier.rationale}
                    </span>
                  </p>
                </div>
                <Link to="/pricing">
                  <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                    See plan <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────

function Stat({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon: React.ElementType; accent?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className={`text-base font-mono font-bold ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  );
}

function Row({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold ${positive ? 'text-accent' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  );
}
