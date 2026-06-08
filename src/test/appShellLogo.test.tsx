import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock heavy CAD/store children so AppShell can render in jsdom
vi.mock('@/components/cad/CADViewer', () => ({ CADViewer: () => <div data-testid="mock-cad-viewer" /> }));
vi.mock('@/components/cad/AnalysisPanel', () => ({ AnalysisPanel: () => <div data-testid="mock-analysis" /> }));
vi.mock('@/components/cad/CopilotPanel', () => ({ CopilotPanel: () => <div data-testid="mock-copilot" /> }));
vi.mock('@/components/cad/UploadOverlay', () => ({ UploadOverlay: () => null }));
vi.mock('@/components/cad/Sidebar', () => ({
  Sidebar: () => (
    <aside data-testid="cad-sidebar">
      <button role="tab">Jobs</button>
      <button role="tab">Files</button>
    </aside>
  ),
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: () => ({
    demoPhase: 'idle',
    setDemoPhase: vi.fn(),
    setUploadedFile: vi.fn(),
    setAnalysisResult: vi.fn(),
    setUploadProgress: vi.fn(),
    setOptimizationResult: vi.fn(),
    setAnalysisError: vi.fn(),
  }),
}));

import { AppShell } from '@/components/cad/AppShell';

const THEMES = ['light', 'dark'] as const;

function renderShell(theme: 'light' | 'dark') {
  return render(
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} themes={['light', 'dark']}>
      <AppShell />
    </ThemeProvider>,
  );
}

describe('AppShell — Midwater logo above the Jobs tab', () => {
  beforeEach(() => {
    cleanup();
    document.documentElement.className = '';
  });

  for (const theme of THEMES) {
    it(`renders the logo in the top header and a Jobs tab below it (${theme} mode)`, () => {
      renderShell(theme);

      const header = screen.getByRole('banner');
      expect(within(header).getByAltText('Midwater')).toBeInTheDocument();
      expect(within(header).getByText(/MID/)).toBeInTheDocument();
      expect(within(header).getByText(/WATER/)).toBeInTheDocument();
      expect(within(header).getByText('v1.0')).toBeInTheDocument();

      const jobsTab = screen.getByRole('tab', { name: 'Jobs' });
      expect(jobsTab).toBeInTheDocument();

      // DOM order: header element must appear before the Jobs tab
      const ordering = header.compareDocumentPosition(jobsTab);
      // eslint-disable-next-line no-bitwise
      expect(ordering & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('AppShell source wires MidwaterLogo into the header (regression guard)', () => {
    const src = readFileSync(resolve(__dirname, '../components/cad/AppShell.tsx'), 'utf8');
    expect(src).toMatch(/MidwaterLogo/);
    // Logo must appear before the closing </motion.header>
    const logoIdx = src.indexOf('<MidwaterLogo');
    const headerEndIdx = src.indexOf('</motion.header>');
    expect(logoIdx).toBeGreaterThan(-1);
    expect(headerEndIdx).toBeGreaterThan(logoIdx);
  });
});
