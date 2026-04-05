import { useState } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Check, Zap, ArrowRight, Sparkles, Shield, Building2,
  BarChart3, Users, Cpu, Globe, Headphones, Clock,
  DollarSign, TrendingDown, ChevronDown,
} from 'lucide-react';

// ─── Tier Data ──────────────────────────────────────────────────

interface Tier {
  id: string;
  name: string;
  price: string;
  period: string;
  tagline: string;
  bestFor: string;
  accent: string;
  accentBg: string;
  glowClass: string;
  popular?: boolean;
  features: string[];
  icon: React.ElementType;
}

const tiers: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$5,000',
    period: '/ year',
    tagline: 'For small teams getting started',
    bestFor: 'Small fabrication buyers',
    accent: 'text-accent',
    accentBg: 'bg-accent/10 border-accent/20',
    glowClass: '',
    icon: Zap,
    features: [
      'Up to 500 part analyses / year',
      'Instant cost estimation',
      'Basic manufacturability insights',
      'Email support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$15,000',
    period: '/ year',
    tagline: 'For growing engineering + procurement teams',
    bestFor: 'Industrial teams scaling sourcing',
    accent: 'text-primary',
    accentBg: 'bg-primary/10 border-primary/20',
    glowClass: 'shadow-[0_0_40px_-8px_hsl(var(--primary)/0.2)]',
    popular: true,
    icon: BarChart3,
    features: [
      'Up to 5,000 part analyses / year',
      'Advanced optimization suggestions',
      'Supplier matching (standard)',
      'Cost benchmarking (historical)',
      'Priority support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$50,000+',
    period: '/ year',
    tagline: 'For high-volume, mission-critical operations',
    bestFor: 'Aerospace, defense, large industrials',
    accent: 'text-purple-400',
    accentBg: 'bg-purple-500/10 border-purple-500/20',
    glowClass: '',
    icon: Building2,
    features: [
      'Unlimited analyses',
      'Advanced optimization engine',
      'Preferred supplier routing',
      'Custom pricing models',
      'API access + integrations',
      'Dedicated success manager',
      'SLA + uptime guarantees',
    ],
  },
];

// ─── Animations ─────────────────────────────────────────────────

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

// ─── Tier Card ──────────────────────────────────────────────────

function TierCard({ tier }: { tier: Tier }) {
  return (
    <motion.div variants={cardVariants} className="flex">
      <Card className={`relative flex flex-col w-full transition-all duration-300 hover:-translate-y-1 ${
        tier.popular
          ? `border-primary/40 ${tier.glowClass}`
          : 'border-border hover:border-muted-foreground/20'
      }`}>
        {tier.popular && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="bg-primary text-primary-foreground text-[10px] font-semibold px-3 shadow-lg">
              Most Popular
            </Badge>
          </div>
        )}

        <CardContent className="flex flex-col flex-1 p-6">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tier.accentBg}`}>
              <tier.icon className={`h-4 w-4 ${tier.accent}`} />
            </div>
            <h3 className={`text-lg font-bold ${tier.accent}`}>{tier.name}</h3>
          </div>

          <p className="text-xs text-muted-foreground mb-4">{tier.tagline}</p>

          {/* Price */}
          <div className="mb-5">
            <span className="text-3xl font-bold text-foreground font-mono tracking-tight">{tier.price}</span>
            <span className="text-sm text-muted-foreground ml-1">{tier.period}</span>
          </div>

          {/* Features */}
          <ul className="space-y-2.5 flex-1 mb-6">
            {tier.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check className={`h-4 w-4 mt-0.5 shrink-0 ${tier.accent}`} />
                <span className="text-foreground/80">{f}</span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <Button
            className={`w-full ${
              tier.popular
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-secondary text-foreground hover:bg-secondary/80'
            }`}
          >
            {tier.id === 'enterprise' ? 'Contact Sales' : 'Get Started'}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>

          <p className="text-[10px] text-muted-foreground text-center mt-2">
            Best for: {tier.bestFor}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Performance Pricing Section ────────────────────────────────

function PerformancePricing() {
  return (
    <motion.div variants={fadeUp}>
      <Card className="border-purple-500/20 bg-gradient-to-br from-card to-purple-500/[0.03]">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
              <TrendingDown className="h-5 w-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-bold text-foreground mb-1">
                Performance Pricing
                <Badge variant="outline" className="ml-2 text-[10px] border-purple-500/30 text-purple-400">
                  Enterprise Only
                </Badge>
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Pay for results — 1–3% of verified cost savings. Only pay when we save you money.
              </p>

              {/* Example */}
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Original Cost</p>
                  <p className="text-sm font-mono font-bold text-foreground">$100,000</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Optimized</p>
                  <p className="text-sm font-mono font-bold text-accent">$80,000</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">Your Fee (2%)</p>
                  <p className="text-sm font-mono font-bold text-purple-400">$400</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 text-center italic">
                $20,000 saved → $400 fee. Easy "yes" decision.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Add-on Section ─────────────────────────────────────────────

function UsageAddOn() {
  return (
    <motion.div variants={fadeUp}>
      <Card className="border-accent/20">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <Cpu className="h-4 w-4 text-accent" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Usage Add-On</p>
            <p className="text-xs text-muted-foreground">Available on all plans</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold font-mono text-foreground">$10</p>
            <p className="text-[10px] text-muted-foreground">per additional analysis</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Trust Signals ──────────────────────────────────────────────

const trustItems = [
  { icon: Shield, label: 'SOC 2 Compliant' },
  { icon: Globe, label: 'Global Supplier Network' },
  { icon: Clock, label: '99.9% Uptime SLA' },
  { icon: Headphones, label: 'Dedicated Support' },
];

// ─── Main Page ──────────────────────────────────────────────────

export default function Pricing() {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="space-y-10"
        >
          {/* Hero */}
          <motion.div variants={fadeUp} className="text-center space-y-3">
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary mb-2">
              <Sparkles className="h-3 w-3 mr-1" /> Powered by Geometry OS
            </Badge>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight leading-tight">
              Instantly price, optimize, and
              <br />
              <span className="text-primary">source any part.</span>
            </h1>
            <p className="text-base text-muted-foreground max-w-lg mx-auto">
              Cut manufacturing costs by 10–25% in minutes — not weeks.
            </p>
          </motion.div>

          {/* Tier Cards */}
          <motion.div
            variants={containerVariants}
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {tiers.map(tier => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </motion.div>

          {/* Add-ons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <UsageAddOn />
            <PerformancePricing />
          </div>

          {/* Trust signals */}
          <motion.div variants={fadeUp}>
            <div className="flex items-center justify-center gap-6 flex-wrap py-4 border-t border-b border-border">
              {trustItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <item.icon className="h-3.5 w-3.5 text-primary/60" />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Enterprise CTA */}
          <motion.div variants={fadeUp}>
            <Card className="border-primary/20 bg-gradient-to-r from-card via-primary/[0.03] to-card">
              <CardContent className="p-6 text-center space-y-3">
                <h2 className="text-lg font-bold text-foreground">
                  Ready to cut costs across your supply chain?
                </h2>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Talk to our team about enterprise deployment, custom integrations, and volume pricing.
                </p>
                <div className="flex items-center justify-center gap-3 pt-1">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                    <Users className="h-4 w-4 mr-1.5" /> Talk to Sales
                  </Button>
                  <Button variant="outline">
                    <DollarSign className="h-4 w-4 mr-1.5" /> See ROI Calculator
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
