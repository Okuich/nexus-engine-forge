import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Zap, Play, FileBox } from 'lucide-react';

interface PipelineUploadProps {
  onRunPipeline: (fileName: string, material: string, process: string) => void;
  onQuickPredict: (fileName: string, material: string, process: string) => void;
  isRunning: boolean;
  isPredicting: boolean;
}

const MATERIALS = ['Al 7075-T6', 'Ti-6Al-4V', 'Inconel 718', 'SS 316L', 'AISI 4340'];
const PROCESSES = ['CNC Milling', '5-Axis CNC', 'Turning', 'EDM', 'Additive (SLM)'];

export function PipelineUpload({ onRunPipeline, onQuickPredict, isRunning, isPredicting }: PipelineUploadProps) {
  const [fileName, setFileName] = useState('');
  const [material, setMaterial] = useState('Al 7075-T6');
  const [process, setProcess] = useState('CNC Milling');
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setFileName(file.name);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  }, []);

  const isReady = fileName.trim().length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Upload Zone */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <FileBox className="h-4 w-4 text-primary" /> CAD File Upload
          </CardTitle>
        </CardHeader>
        <CardContent>
          <motion.div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            animate={{ borderColor: isDragging ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
            className="relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors hover:border-primary/50"
          >
            <input
              type="file"
              accept=".step,.stp,.stl,.iges,.igs,.obj"
              onChange={handleFileSelect}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-foreground font-mono">
              {fileName || 'Drop CAD file here'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              .STEP · .STL · .IGES · .OBJ
            </p>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-primary/5 rounded-lg flex items-center justify-center"
              >
                <p className="text-sm font-mono text-primary">Release to upload</p>
              </motion.div>
            )}
          </motion.div>

          {!fileName && (
            <div className="mt-3">
              <Label className="text-xs font-mono text-muted-foreground">Or enter filename manually</Label>
              <Input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="e.g. Turbine_Housing_v4.step"
                className="mt-1 font-mono text-sm bg-secondary border-border"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-sm text-muted-foreground uppercase tracking-wider">
            Analysis Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">Material</Label>
            <Select value={material} onValueChange={setMaterial}>
              <SelectTrigger className="font-mono text-sm bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATERIALS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">Manufacturing Process</Label>
            <Select value={process} onValueChange={setProcess}>
              <SelectTrigger className="font-mono text-sm bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROCESSES.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-3 space-y-2">
            <Button
              onClick={() => onRunPipeline(fileName, material, process)}
              disabled={!isReady || isRunning}
              className="w-full gap-2 font-mono"
            >
              <Play className="h-4 w-4" />
              {isRunning ? 'Starting Pipeline…' : 'Run Full Pipeline'}
            </Button>
            <Button
              variant="outline"
              onClick={() => onQuickPredict(fileName, material, process)}
              disabled={!isReady || isPredicting}
              className="w-full gap-2 font-mono text-xs"
            >
              <Zap className="h-3.5 w-3.5" />
              {isPredicting ? 'Running…' : 'Quick Inference Only'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
