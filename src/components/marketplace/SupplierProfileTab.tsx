import { useState } from 'react';
import { Save, Building2, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { marketplaceService } from '@/lib/marketplace';
import { toast } from 'sonner';

interface ProfileForm {
  companyName: string;
  materials: string;
  processes: string;
  certifications: string;
  region: string;
  maxComplexity: number;
  leadTimeDays: number;
  qualityRating: number;
  minOrderUsd: number;
  pricingMultiplier: number;
  active: boolean;
}

const defaultForm: ProfileForm = {
  companyName: '',
  materials: 'Aluminum 6061, Ti-6Al-4V, Stainless 316L',
  processes: 'CNC Milling, CNC Turning, Wire EDM',
  certifications: 'ISO 9001, AS9100',
  region: 'US-East',
  maxComplexity: 0.85,
  leadTimeDays: 10,
  qualityRating: 0.9,
  minOrderUsd: 500,
  pricingMultiplier: 1.0,
  active: true,
};

export function SupplierProfileTab() {
  const [form, setForm] = useState<ProfileForm>(defaultForm);
  const [saving, setSaving] = useState(false);

  const update = (key: keyof ProfileForm, value: string | number | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.companyName.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      await marketplaceService.upsertSupplierProfile({
        companyName: form.companyName,
        materials: form.materials.split(',').map((s) => s.trim()).filter(Boolean),
        processes: form.processes.split(',').map((s) => s.trim()).filter(Boolean),
        certifications: form.certifications.split(',').map((s) => s.trim()).filter(Boolean),
        region: form.region,
        maxComplexity: form.maxComplexity,
        leadTimeDays: form.leadTimeDays,
        qualityRating: form.qualityRating,
        minOrderUsd: form.minOrderUsd,
        pricingMultiplier: form.pricingMultiplier,
        active: form.active,
      });
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="w-5 h-5 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Supplier Profile</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Company Name" colSpan={2}>
          <Input value={form.companyName} onChange={(e) => update('companyName', e.target.value)} className="bg-secondary border-border" placeholder="Acme Precision Machining" />
        </Field>

        <Field label="Materials (comma-separated)" colSpan={2}>
          <Input value={form.materials} onChange={(e) => update('materials', e.target.value)} className="bg-secondary border-border" />
        </Field>

        <Field label="Processes (comma-separated)" colSpan={2}>
          <Input value={form.processes} onChange={(e) => update('processes', e.target.value)} className="bg-secondary border-border" />
        </Field>

        <Field label="Certifications (comma-separated)" colSpan={2}>
          <Input value={form.certifications} onChange={(e) => update('certifications', e.target.value)} className="bg-secondary border-border" />
        </Field>

        <Field label="Region">
          <Input value={form.region} onChange={(e) => update('region', e.target.value)} className="bg-secondary border-border" />
        </Field>

        <Field label="Max Complexity (0–1)">
          <Input type="number" step="0.05" min="0" max="1" value={form.maxComplexity} onChange={(e) => update('maxComplexity', Number(e.target.value))} className="bg-secondary border-border" />
        </Field>

        <Field label="Lead Time (days)">
          <Input type="number" min="1" value={form.leadTimeDays} onChange={(e) => update('leadTimeDays', Number(e.target.value))} className="bg-secondary border-border" />
        </Field>

        <Field label="Quality Rating (0–1)">
          <Input type="number" step="0.05" min="0" max="1" value={form.qualityRating} onChange={(e) => update('qualityRating', Number(e.target.value))} className="bg-secondary border-border" />
        </Field>

        <Field label="Min Order (USD)">
          <Input type="number" min="0" value={form.minOrderUsd} onChange={(e) => update('minOrderUsd', Number(e.target.value))} className="bg-secondary border-border" />
        </Field>

        <Field label="Pricing Multiplier">
          <Input type="number" step="0.05" min="0.1" value={form.pricingMultiplier} onChange={(e) => update('pricingMultiplier', Number(e.target.value))} className="bg-secondary border-border" />
        </Field>

        <div className="col-span-2 flex items-center justify-between bg-card border border-border rounded-md p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Active</p>
            <p className="text-xs text-muted-foreground">Appear in supplier matching results</p>
          </div>
          <Switch checked={form.active} onCheckedChange={(v) => update('active', v)} />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
        Save Profile
      </Button>
    </div>
  );
}

function Field({ label, children, colSpan = 1 }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <Label className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
