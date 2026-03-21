import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StartTrainingRequest } from '@/lib/ml/types';
import { DEFAULT_TRAINING_CONFIG } from '@/lib/ml/types';

interface NewJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (req: StartTrainingRequest) => void;
  isSubmitting: boolean;
}

export function NewJobDialog({ open, onOpenChange, onSubmit, isSubmitting }: NewJobDialogProps) {
  const [name, setName] = useState('');
  const [modelType, setModelType] = useState('gat');
  const [epochs, setEpochs] = useState(100);
  const [lr, setLr] = useState(0.001);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      model_type: modelType,
      config: {
        ...DEFAULT_TRAINING_CONFIG,
        epochs,
        learning_rate: lr,
      },
    });
    setName('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-foreground">New Training Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">Job Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GAT_Manufacturability_v3"
              className="font-mono text-sm bg-secondary border-border"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-mono text-muted-foreground">Model</Label>
              <Select value={modelType} onValueChange={setModelType}>
                <SelectTrigger className="font-mono text-sm bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gat">GAT</SelectItem>
                  <SelectItem value="gcn">GCN</SelectItem>
                  <SelectItem value="graphsage">GraphSAGE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-mono text-muted-foreground">Epochs</Label>
              <Input
                type="number"
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="font-mono text-sm bg-secondary border-border"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">Learning Rate</Label>
            <Input
              type="number"
              step="0.0001"
              value={lr}
              onChange={(e) => setLr(Number(e.target.value))}
              className="font-mono text-sm bg-secondary border-border"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="font-mono text-xs">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || isSubmitting} className="font-mono text-xs gap-2">
            {isSubmitting ? 'Starting…' : 'Start Training'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
