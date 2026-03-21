import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, FileText, MessageSquareQuote, UserCog, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarketplace } from '@/hooks/useMarketplace';
import { OpenRFQsTab } from '@/components/marketplace/OpenRFQsTab';
import { MyQuotesTab } from '@/components/marketplace/MyQuotesTab';
import { SupplierProfileTab } from '@/components/marketplace/SupplierProfileTab';
import { CreateRFQDialog } from '@/components/marketplace/CreateRFQDialog';

type Tab = 'rfqs' | 'quotes' | 'profile';

const tabs = [
  { key: 'rfqs' as const, label: 'Open RFQs', icon: FileText },
  { key: 'quotes' as const, label: 'My Quotes', icon: MessageSquareQuote },
  { key: 'profile' as const, label: 'Supplier Profile', icon: UserCog },
];

export default function Marketplace() {
  const [activeTab, setActiveTab] = useState<Tab>('rfqs');
  const marketplace = useMarketplace();

  useEffect(() => {
    marketplace.loadRFQs({ status: 'open' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Store className="w-5 h-5 text-primary" />
          <h1 className="text-sm font-semibold tracking-tight">Supplier Marketplace</h1>
        </div>
        <div className="flex items-center gap-3">
          <CreateRFQDialog onSubmit={marketplace.createRFQ} loading={marketplace.loading} />
        </div>
        {marketplace.error && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded-md font-mono"
          >
            {marketplace.error}
          </motion.div>
        )}
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex border-b border-border bg-card shrink-0 px-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative flex items-center gap-2 px-4 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activeTab === tab.key
                ? 'text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {activeTab === tab.key && (
              <motion.div
                layoutId="marketplace-tab"
                className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
              />
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'rfqs' && (
            <motion.div key="rfqs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <OpenRFQsTab marketplace={marketplace} />
            </motion.div>
          )}
          {activeTab === 'quotes' && (
            <motion.div key="quotes" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <MyQuotesTab marketplace={marketplace} />
            </motion.div>
          )}
          {activeTab === 'profile' && (
            <motion.div key="profile" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <SupplierProfileTab />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
