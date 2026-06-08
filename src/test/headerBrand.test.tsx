import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
import { MidwaterLogo } from '@/components/brand/MidwaterLogo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';

type Theme = 'light' | 'dark';
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;
const THEMES: Theme[] = ['light', 'dark'];

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

function renderHeader(theme: Theme, showWordmark = true) {
  return render(
    <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} themes={['light', 'dark']}>
      <header data-testid="app-header" className="h-12 flex items-center gap-3 bg-card px-2">
        <MidwaterLogo size={24} showWordmark={showWordmark} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
    </ThemeProvider>,
  );
}

describe('Header logo + theme toggle', () => {
  beforeEach(() => {
    cleanup();
    document.documentElement.className = '';
    window.localStorage.clear();
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      it(`renders logo image and wordmark in ${theme} mode @ ${viewport.name}`, () => {
        setViewport(viewport.width, viewport.height);
        renderHeader(theme);

        const img = screen.getByAltText('Midwater') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toMatch(/midwater-logo\.png$/);

        // Wordmark
        expect(screen.getByText(/MID/)).toBeInTheDocument();
        expect(screen.getByText(/WATER/)).toBeInTheDocument();

        // Toggle present and accessible
        expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
      });

      it(`renders logo without wordmark (collapsed) in ${theme} mode @ ${viewport.name}`, () => {
        setViewport(viewport.width, viewport.height);
        render(
          <ThemeProvider attribute="class" defaultTheme={theme} enableSystem={false} themes={['light', 'dark']}>
            <MidwaterLogo size={20} />
          </ThemeProvider>,
        );
        expect(screen.getByAltText('Midwater')).toBeInTheDocument();
        expect(screen.queryByText(/MID/)).not.toBeInTheDocument();
      });
    }
  }

  it('toggle switches html class between light and dark', async () => {
    const user = userEvent.setup();
    renderHeader('dark');

    // next-themes applies the class asynchronously; await a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(screen.getByRole('button', { name: /toggle theme/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('logo art sits inside a dark chip so it stays legible on any theme background', () => {
    renderHeader('light');
    const img = screen.getByAltText('Midwater');
    const chip = img.parentElement as HTMLElement;
    // Tailwind arbitrary class encodes the dark midnight HSL
    expect(chip.className).toMatch(/bg-\[hsl\(220_25%_5%\)\]/);
  });
});
