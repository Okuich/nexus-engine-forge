import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTrainingJobs, useJobMetrics, useCreateAndStartJob, useCancelJob, useRealtimeJob } from '@/hooks/useTrainingJobs';
import { JobsTable } from '@/components/ml/JobsTable';
import { MetricsChart } from '@/components/ml/MetricsChart';
import { NewJobDialog } from '@/components/ml/NewJobDialog';
import { JobDetail } from '@/components/ml/JobDetail';
import { BenchmarkDashboard } from '@/components/ml/BenchmarkDashboard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Brain, Activity, Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';

const MLDashboard = () => {
  const { data: jobs, isLoading } = useTrainingJobs();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('training');
  const { data: metrics } = useJobMetrics(selectedJobId);
  const liveMetrics = useRealtimeJob(selectedJobId);
  const createJob = useCreateAndStartJob();
  const cancel = useCancelJob();

  const allMetrics = [...(metrics ?? []), ...liveMetrics];
  const selectedJob = jobs?.find((j) => j.id === selectedJobId);

  const activeCount = jobs?.filter((j) => j.status === 'training' || j.status === 'preprocessing').length ?? 0;

  return (
    <div className="min-h-screen bg-background industrial-grid">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground font-mono">ML Training Dashboard</h1>
                <p className="text-xs text-muted-foreground">GNN Model Orchestration & Benchmarking</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20"
              >
                <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-xs font-mono text-primary">{activeCount} active</span>
              </motion.div>
            )}
            <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              New Training Job
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-card border border-border mb-6">
            <TabsTrigger value="training" className="gap-2 font-mono text-xs">
              <Brain className="h-3.5 w-3.5" /> Training
            </TabsTrigger>
            <TabsTrigger value="benchmarks" className="gap-2 font-mono text-xs">
              <Gauge className="h-3.5 w-3.5" /> Benchmarks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="training">
            <AnimatePresence mode="wait">
              {selectedJob ? (
                <motion.div
                  key="detail"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedJobId(null)}
                    className="text-muted-foreground gap-2"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> All Jobs
                  </Button>
                  <JobDetail job={selectedJob} onCancel={() => cancel.mutate(selectedJob.id)} />
                  {allMetrics.length > 0 && <MetricsChart metrics={allMetrics} />}
                </motion.div>
              ) : (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2 }}
                >
                  <JobsTable
                    jobs={jobs ?? []}
                    isLoading={isLoading}
                    onSelect={setSelectedJobId}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="benchmarks">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <BenchmarkDashboard />
            </motion.div>
          </TabsContent>
        </Tabs>
      </main>

      <NewJobDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={(req) => {
          createJob.mutate(req);
          setDialogOpen(false);
        }}
        isSubmitting={createJob.isPending}
      />
    </div>
  );
};

export default MLDashboard;
