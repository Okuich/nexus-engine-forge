import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { toast } from 'sonner';
import type { CreateRFQRequest } from '@/lib/marketplace/types';

const MATERIALS = ['Aluminum 6061', 'Aluminum 7075', 'Steel 1018', 'Steel 4140', 'Stainless 304', 'Stainless 316', 'Titanium Ti-6Al-4V', 'Brass C360', 'Copper C110', 'Nylon 6/6', 'ABS', 'PEEK'];
const PROCESSES = ['CNC Milling', 'CNC Turning', 'Sheet Metal', 'Injection Molding', 'Die Casting', '3D Printing (SLS)', '3D Printing (FDM)', 'Wire EDM'];
const CERTIFICATIONS = ['ISO 9001', 'ISO 13485', 'AS9100', 'ITAR', 'NADCAP'];

const schema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(120),
  partName: z.string().trim().min(1, 'Part name is required').max(100),
  material: z.string().min(1, 'Select a material'),
  process: z.string().min(1, 'Select a process'),
  quantity: z.coerce.number().int().min(1, 'Min quantity is 1').max(1_000_000),
  description: z.string().trim().max(2000).optional(),
  maxLeadTimeDays: z.coerce.number().int().min(1).max(365).optional().or(z.literal('')),
  targetCostUsd: z.coerce.number().min(0.01).max(10_000_000).optional().or(z.literal('')),
  region: z.string().optional(),
  requiredCertifications: z.array(z.string()).optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onSubmit: (req: CreateRFQRequest) => Promise<unknown>;
  loading?: boolean;
}

export function CreateRFQDialog({ onSubmit, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedCerts, setSelectedCerts] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      partName: '',
      material: '',
      process: '',
      quantity: 1,
      description: '',
      maxLeadTimeDays: '',
      targetCostUsd: '',
      region: '',
      requiredCertifications: [],
    },
  });

  const handleSubmit = async (values: FormValues) => {
    try {
      const req: CreateRFQRequest = {
        title: values.title,
        partName: values.partName,
        material: values.material,
        process: values.process,
        quantity: values.quantity,
        description: values.description || undefined,
        maxLeadTimeDays: typeof values.maxLeadTimeDays === 'number' ? values.maxLeadTimeDays : undefined,
        targetCostUsd: typeof values.targetCostUsd === 'number' ? values.targetCostUsd : undefined,
        region: values.region || undefined,
        requiredCertifications: selectedCerts.length > 0 ? selectedCerts : undefined,
      };
      await onSubmit(req);
      toast.success('RFQ created successfully');
      form.reset();
      setSelectedCerts([]);
      setOpen(false);
    } catch {
      toast.error('Failed to create RFQ');
    }
  };

  const toggleCert = (cert: string) => {
    setSelectedCerts((prev) =>
      prev.includes(cert) ? prev.filter((c) => c !== cert) : [...prev, cert]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Create RFQ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Request for Quotation</DialogTitle>
          <DialogDescription>Fill in the details below to submit a new RFQ to the marketplace.</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 pt-2">
            {/* Row 1: Title */}
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl><Input placeholder="e.g. CNC Housing Bracket" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Row 2: Part + Quantity */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="partName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Part Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Motor Housing" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="quantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl><Input type="number" min={1} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 3: Material + Process */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="material" render={({ field }) => (
                <FormItem>
                  <FormLabel>Material</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select material" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {MATERIALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="process" render={({ field }) => (
                <FormItem>
                  <FormLabel>Process</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {PROCESSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Row 4: Lead time + Target cost + Region */}
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="maxLeadTimeDays" render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Lead Time (days)</FormLabel>
                  <FormControl><Input type="number" min={1} placeholder="Optional" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="targetCostUsd" render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Cost (USD)</FormLabel>
                  <FormControl><Input type="number" min={0} step="0.01" placeholder="Optional" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="region" render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {['US-East', 'US-West', 'EU-West', 'EU-East', 'Asia-Pacific'].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Certifications */}
            <div className="space-y-2">
              <FormLabel>Required Certifications</FormLabel>
              <div className="flex flex-wrap gap-2">
                {CERTIFICATIONS.map((cert) => (
                  <button
                    key={cert}
                    type="button"
                    onClick={() => toggleCert(cert)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      selectedCerts.includes(cert)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {cert}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea rows={3} placeholder="Additional details, tolerances, finish requirements…" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Submitting…' : 'Submit RFQ'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
