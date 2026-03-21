import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { usePipelines, useStartPipeline, useQuickInference, usePipelineRealtime } from '@/hooks/usePipeline';
import { PipelineUpload } from '@/components/ml/PipelineUpload';
import { PipelineResults } from '@/components/ml/PipelineResults';
import { PipelineHistory } from '@/components/ml/PipelineHistory';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Cpu, Upload, History, Zap } from 'lucide-react';
import type { InferenceResult } from '@/lib/ml/pipeline';

const MLPipeline = () => {
  const { data: pipelines, isLoading } = usePipelines();
  const startPipeline = useStartPipeline();
  const quickInference = useQuickInference();
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const [inferenceResult, setInferenceResult] = useState<InferenceResult | null>(null);
  const [activeTab, setActiveTab] = useState('upload');

  const liveJob = usePipelineRealtime(activePipelineId);

  const handleUpload = async (fileName: string, material: string, process: string) => {
    const result = await startPipeline.mutateAsync({ file_name: fileName, material, process });
    setActivePipelineId(result.pipeline_id);
    setActiveTab('results');
  };

  const handleQuickPredict = async (fileName: string, material: string, process: string) => {
    const result = await quickInference.mutateAsync({ fileName, material, process });
    setInferenceResult(result);
    setActiveTab('results');
  };

  return (
    <div className="min-h-screen bg-background industrial-grid">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Cpu className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground font-mono">
                  FORGE<span className="text-primary">CAD</span> Pipeline
                </h1>
                <p className="text-xs text-muted-foreground">CAD → GNN → Manufacturing Intelligence</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/ml">
              <Button variant="outline" size="sm" className="gap-2 font-mono text-xs">
                <Zap className="h-3.5 w-3.5" /> Training Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-card border border-border mb-6">
            <TabsTrigger value="upload" className="gap-2 font-mono text-xs">
              <Upload className="h-3.5 w-3.5" /> Upload & Analyze
            </TabsTrigger>
            <TabsTrigger value="results" className="gap-2 font-mono text-xs">
              <Zap className="h-3.5 w-3.5" /> Results
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 font-mono text-xs">
              <History className="h-3.5 w-3.5" /> History
            </TabsTrigger>
          </TabsList>

          <AnimatePresence mode="wait">
            <TabsContent value="upload" key="upload">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
              >
                <PipelineUpload
                  onRunPipeline={handleUpload}
                  onQuickPredict={handleQuickPredict}
                  isRunning={startPipeline.isPending}
                  isPredicting={quickInference.isPending}
                />
              </motion.div>
            </TabsContent>

            <TabsContent value="results" key="results">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
              >
                <PipelineResults
                  pipelineJob={liveJob}
                  inferenceResult={inferenceResult}
                  pipelineId={activePipelineId}
                />
              </motion.div>
            </TabsContent>

            <TabsContent value="history" key="history">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
              >
                <PipelineHistory
                  pipelines={pipelines ?? []}
                  isLoading={isLoading}
                  onSelect={(id) => {
                    setActivePipelineId(id);
                    setActiveTab('results');
                  }}
                />
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </Tabs>
      </main>
    </div>
  );
};

export default MLPipeline;
