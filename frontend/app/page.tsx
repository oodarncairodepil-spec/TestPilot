'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AlertCircle, Copy, Globe, LayoutDashboard, ListChecks, MousePointerClick, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plus, Save, TestTube2, Trash2, WandSparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type Script = {
  id: string;
  name: string;
  content: string;
};

type Run = {
  id: string;
  scriptName: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'timeout' | 'cancelled';
  durationMs: number | null;
  createdAt: string;
};

type BuilderSelector = {
  tag: string;
  text: string;
  id: string;
  name: string;
  className: string;
  css: string;
  xpath: string;
  url: string;
  timestamp: string;
};
type LeftMenu = 'dashboard' | 'scenario' | 'builder' | 'test-result';
type BuilderMode = 'browse' | 'capture';

const statusClassMap: Record<Run['status'], string> = {
  queued: 'border-amber-500/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/15',
  running: 'border-sky-500/30 bg-sky-500/15 text-sky-200 hover:bg-sky-500/15',
  passed: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15',
  failed: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/15',
  timeout: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/15',
  cancelled: 'border-slate-500/30 bg-slate-500/20 text-slate-200 hover:bg-slate-500/20'
};

const menuItems: { id: LeftMenu; label: string; icon: typeof LayoutDashboard; description: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview, volume, and quick health' },
  { id: 'scenario', label: 'Scenario', icon: ListChecks, description: 'Create, edit, and run test scripts' },
  { id: 'builder', label: 'Builder', icon: WandSparkles, description: 'Open URLs and collect selector context' },
  { id: 'test-result', label: 'Test Result', icon: TestTube2, description: 'Review runs, logs, and artifacts' }
];

const resolveApiBase = (): string => {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://x300.taila1632d.ts.net:4000';
};

const resolveWsBase = (): string => {
  return process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://x300.taila1632d.ts.net:4000';
};

const seededTest = `import { test, expect } from '@playwright/test';

test('skorpintar login', async ({ page }, testInfo) => {
  await page.goto('https://beta.skorpintar.com/login');

  await page.getByRole('textbox', { name: /email/i }).fill('ligar@siapkpr.com');
  await page.getByRole('textbox', { name: /kata sandi/i }).fill('abc123');
  await page.getByRole('button', { name: /^masuk$/i }).click();

  await page.waitForURL('https://saas.beta.skorpintar.com/dashboard', { timeout: 60_000 });
  await expect(page).toHaveURL('https://saas.beta.skorpintar.com/dashboard');

  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');

  const screenshotPath = testInfo.outputPath('dashboard-loaded.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('dashboard-loaded', {
    path: screenshotPath,
    contentType: 'image/png'
  });

  await page.waitForTimeout(5_000);
});`;

const newScenarioTemplateName = 'new-scenario.spec.ts';

const newScenarioTemplateContent = `import { test, expect } from '@playwright/test';

test('new scenario', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveURL('https://example.com');
});`;

const formatDuration = (durationMs: number | null): string => {
  if (!durationMs) return '-';
  return `${(durationMs / 1000).toFixed(2)}s`;
};

const escapeTsString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export default function HomePage() {
  const router = useRouter();
  const resultsPageSize = 10;
  const apiBase = useMemo(() => resolveApiBase(), []);
  const wsBase = useMemo(() => resolveWsBase(), []);
  const [leftMenu, setLeftMenu] = useState<LeftMenu>('dashboard');
  const [scripts, setScripts] = useState<Script[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, running: 0 });
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState('skorpintar-login.spec.ts');
  const [scriptContent, setScriptContent] = useState(seededTest);
  const [resultsPage, setResultsPage] = useState(1);

  const [builderInputUrl, setBuilderInputUrl] = useState('https://saas.beta.skorpintar.com/');
  const [builderMode, setBuilderMode] = useState<BuilderMode>('browse');
  const [builderLastOpenedUrl, setBuilderLastOpenedUrl] = useState('');
  const [builderStatus, setBuilderStatus] = useState('');
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [builderCaptured, setBuilderCaptured] = useState<BuilderSelector[]>([]);
  const [scenarioSearch, setScenarioSearch] = useState('');
  const [isScenarioDropdownOpen, setIsScenarioDropdownOpen] = useState(false);
  const [isEditingScenarioName, setIsEditingScenarioName] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunningScript, setIsRunningScript] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSavingScript, setIsSavingScript] = useState(false);

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId]
  );

  const selectScript = useCallback((script: Script) => {
    setSelectedScriptId(script.id);
    setScriptName(script.name);
    setScriptContent(script.content);
    setScenarioSearch(script.name);
  }, []);

  const filteredScripts = useMemo(() => {
    const query = scenarioSearch.trim().toLowerCase();
    if (!query) return scripts;
    return scripts.filter((script) => script.name.toLowerCase().includes(query) || script.id.toLowerCase().includes(query));
  }, [scripts, scenarioSearch]);

  const selectedScenarioLabel = useMemo(() => {
    if (selectedScript) {
      return selectedScript.name;
    }
    return scriptName.trim() || 'Select a scenario';
  }, [scriptName, selectedScript]);

  const totalResultsPages = Math.max(1, Math.ceil(runs.length / resultsPageSize));
  const pagedRuns = useMemo(() => {
    const start = (resultsPage - 1) * resultsPageSize;
    return runs.slice(start, start + resultsPageSize);
  }, [runs, resultsPage]);

  const latestCaptured = builderCaptured[0] ?? null;
  const generatedSnippet = useMemo(() => {
    if (!latestCaptured) return '';
    if (latestCaptured.css) {
      return `const target = page.locator('${escapeTsString(latestCaptured.css)}');\nawait target.click();`;
    }
    if (latestCaptured.xpath) {
      return `const target = page.locator('xpath=${escapeTsString(latestCaptured.xpath)}');\nawait target.click();`;
    }
    return '';
  }, [latestCaptured]);

  const refreshScripts = useCallback(async () => {
    try {
      setScriptsError(null);
      const response = await fetch(`${apiBase}/api/scripts`);
      if (!response.ok) {
        throw new Error(`Unable to load scenarios (${response.status})`);
      }
      const data = (await response.json()) as { items: Script[] };
      setScripts(data.items);
      if (!selectedScriptId && data.items.length > 0) {
        selectScript(data.items[0]);
      }
    } catch (error) {
      setScriptsError(error instanceof Error ? error.message : 'Unable to load scenarios');
    }
  }, [selectedScriptId, apiBase, selectScript]);

  const refreshRuns = useCallback(async () => {
    try {
      setRunsError(null);
      const response = await fetch(`${apiBase}/api/runs`);
      if (!response.ok) {
        throw new Error(`Unable to load runs (${response.status})`);
      }
      const data = (await response.json()) as { items: Run[]; stats: typeof stats };
      setRuns(data.items);
      setStats(data.stats);
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : 'Unable to load runs');
    }
  }, [apiBase]);

  useEffect(() => {
    void refreshScripts();
    void refreshRuns();
    const interval = setInterval(() => {
      void refreshRuns();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshRuns, refreshScripts]);


  const saveScript = async () => {
    setIsSavingScript(true);
    setSaveError(null);
    try {
      const response = await fetch(
        selectedScript ? `${apiBase}/api/scripts/${selectedScript.id}` : `${apiBase}/api/scripts`,
        {
          method: selectedScript ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: scriptName, content: scriptContent })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Unable to save scenario (${response.status})`);
      }

      await refreshScripts();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save scenario');
    } finally {
      setIsSavingScript(false);
    }
  };

  const deleteScript = async () => {
    if (!selectedScript) return;
    await fetch(`${apiBase}/api/scripts/${selectedScript.id}`, { method: 'DELETE' });
    setSelectedScriptId(null);
    setScriptName('new-test.spec.ts');
    setScriptContent("import { test } from '@playwright/test';\n\ntest('name', async () => {\n});\n");
    await refreshScripts();
  };

  const runScript = async () => {
    if (!selectedScript) return;
    setIsRunningScript(true);
    setRunError(null);
    try {
      const response = await fetch(`${apiBase}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: selectedScript.id })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Unable to start run (${response.status})`);
      }

      const run = (await response.json()) as { id: string };
      await refreshRuns();
      setLeftMenu('test-result');
      router.push(`/run/${run.id}`);
    } catch (error) {
      setRunError(
        error instanceof Error
          ? `Unable to start the remote worker. ${error.message}`
          : 'Unable to start the remote worker.'
      );
    } finally {
      setIsRunningScript(false);
    }
  };

  const openBuilderTarget = () => {
    let parsed: URL;
    try {
      parsed = new URL(builderInputUrl);
    } catch {
      setBuilderStatus('Please enter a valid URL, including http:// or https://');
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      setBuilderStatus('Only http/https URLs are supported');
      return;
    }

    const opened = window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    if (!opened) {
      setBuilderStatus('Popup blocked. Please allow popups, then try again.');
      return;
    }

    setBuilderLastOpenedUrl(parsed.toString());
    setBuilderStatus(`Opened target URL in ${builderMode.toUpperCase()} mode.`);
  };


  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setBuilderStatus('Copied to clipboard');
    } catch {
      setBuilderStatus('Unable to copy to clipboard');
    }
  };

  const chooseScenario = (script: Script) => {
    selectScript(script);
    setScenarioSearch(script.name);
    setIsScenarioDropdownOpen(false);
    setIsEditingScenarioName(false);
  };

  const createNewScenario = () => {
    setSelectedScriptId(null);
    setScriptName(newScenarioTemplateName);
    setScriptContent(newScenarioTemplateContent);
    setScenarioSearch('');
    setIsScenarioDropdownOpen(false);
    setIsEditingScenarioName(true);
    setSaveError(null);
    setRunError(null);
    setLeftMenu('scenario');
  };
  useEffect(() => {
    if (resultsPage > totalResultsPages) {
      setResultsPage(totalResultsPages);
    }
  }, [resultsPage, totalResultsPages]);

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className={cn('grid gap-6', isMenuCollapsed ? 'grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[320px_minmax(0,1fr)]')}>
          <Card className="h-fit border-white/10 bg-card/90 backdrop-blur lg:sticky lg:top-6">
            <CardHeader className={cn('pb-4', isMenuCollapsed && 'px-3 pb-2 pt-3')}>
              <div className={cn('flex items-center justify-between gap-3', isMenuCollapsed && 'justify-center')}>
                {!isMenuCollapsed && (
                  <div>
                    <CardTitle className="text-lg">Navigation</CardTitle>
                    <CardDescription>Jump across the workflow in one place.</CardDescription>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsMenuCollapsed((v) => !v)}
                  aria-label="Toggle menu"
                  className={cn(
                    isMenuCollapsed &&
                      'relative h-12 w-12 rounded-none border-0 bg-transparent p-0 text-slate-300 hover:bg-transparent hover:text-white'
                  )}
                >
                  {isMenuCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={cn('space-y-3', isMenuCollapsed && 'px-3 pb-3 pt-0')}>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = leftMenu === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLeftMenu(item.id)}
                    className={cn(
                      isMenuCollapsed
                        ? 'group relative flex h-12 w-full items-center justify-center text-left text-slate-300 transition-all'
                        : 'group flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all sm:min-h-[56px] sm:px-3.5 sm:py-2.5',
                      isMenuCollapsed
                        ? isActive
                          ? 'text-white'
                          : 'text-slate-300 hover:text-white'
                        : isActive
                          ? 'border-primary/40 bg-primary/15 text-white shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                          : 'border-white/5 bg-white/[0.03] text-slate-300 hover:border-white/10 hover:bg-white/[0.06]'
                    )}
                  >
                    {isMenuCollapsed && (
                      <span
                        className={cn(
                          'absolute left-0 top-1/2 h-6 w-px -translate-y-1/2 rounded-full transition-all',
                          isActive ? 'bg-primary' : 'bg-transparent group-hover:bg-white/30'
                        )}
                      />
                    )}
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                      isMenuCollapsed
                        ? isActive
                          ? 'text-primary-foreground'
                          : 'text-slate-200'
                        : isActive
                          ? 'rounded-xl bg-primary/20 text-primary-foreground'
                          : 'rounded-xl bg-white/5 text-slate-200'
                    )}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    {!isMenuCollapsed && (
                      <span className="flex min-w-0 flex-1 flex-col justify-center text-left leading-tight">
                        <span className="truncate text-sm font-medium">{item.label}</span>
                        <span className="mt-1 truncate text-xs text-slate-400">{item.description}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <section className="space-y-6">
          {leftMenu === 'dashboard' && (
            <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
              <Card className="border-white/10 bg-card/90 backdrop-blur">
                <CardHeader>
                  <CardTitle>Dashboard</CardTitle>
                  <CardDescription>High-level run health, throughput, and action shortcuts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="rounded-3xl border border-sky-400/20 bg-sky-500/10 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Active API Base URL</p>
                    <p className="mt-3 break-all text-sm font-medium text-white">{apiBase}</p>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">Active WebSocket Base URL</p>
                    <p className="mt-3 break-all text-sm font-medium text-white">{wsBase}</p>
                    <p className="mt-2 text-sm text-sky-100/80">Use this value to confirm whether the frontend is pointing to localhost or the remote host.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      {
                        label: 'Execution throughput',
                        value: `${stats.total}`,
                        caption: 'Total runs processed in this workspace',
                        tone: 'from-sky-500/20 to-blue-500/5'
                      },
                      {
                        label: 'Success ratio',
                        value: stats.total ? `${Math.round((stats.passed / stats.total) * 100)}%` : '0%',
                        caption: 'Share of successful runs across all executions',
                        tone: 'from-emerald-500/20 to-emerald-500/5'
                      },
                      {
                        label: 'Failures detected',
                        value: `${stats.failed}`,
                        caption: 'Runs that need investigation or reruns',
                        tone: 'from-rose-500/20 to-rose-500/5'
                      },
                      {
                        label: 'Currently active',
                        value: `${stats.running}`,
                        caption: 'Runs streaming live execution status right now',
                        tone: 'from-amber-500/20 to-amber-500/5'
                      }
                    ].map((item) => (
                      <div key={item.label} className={cn('rounded-3xl border border-white/10 bg-gradient-to-br p-5', item.tone)}>
                        <p className="text-sm text-slate-300">{item.label}</p>
                        <p className="mt-3 text-4xl font-semibold text-white">{item.value}</p>
                        <p className="mt-3 text-sm text-slate-400">{item.caption}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                      <p className="text-sm font-medium text-white">Recommended next step</p>
                      <p className="mt-2 text-sm text-slate-400">
                        Use Scenario to edit a test, then send it straight into execution and review its artifacts from Test Result.
                      </p>
                    </div>
                    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                      <p className="text-sm font-medium text-white">Builder utility</p>
                      <p className="mt-2 text-sm text-slate-400">
                        Open external URLs in a cleaner utility view while keeping the main command center focused on execution.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-card/90 backdrop-blur">
                <CardHeader>
                  <CardTitle>Workflow</CardTitle>
                  <CardDescription>Designed for script authoring, execution, and inspection.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    ['1', 'Choose a scenario', 'Search or switch between stored test scripts.'],
                    ['2', 'Refine the script', 'Use the Monaco editor with a cleaner authoring surface.'],
                    ['3', 'Run and monitor', 'Start execution and stream logs from the results area.'],
                    ['4', 'Inspect outputs', 'Preview screenshots, videos, and downloadable artifacts.']
                  ].map(([step, title, text]) => (
                    <div key={step} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary-foreground">
                        {step}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{title}</p>
                        <p className="mt-1 text-sm text-slate-400">{text}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {leftMenu === 'scenario' && (
            <Card className="border-white/10 bg-card/90 backdrop-blur">
              <CardHeader className="space-y-4 pb-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <CardTitle>Scenario Studio</CardTitle>
                    <CardDescription>Create, search, refine, and launch Playwright test scenarios from one surface.</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <Button variant="destructive" onClick={() => setIsDeleteConfirmOpen(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                    <Button onClick={saveScript} disabled={isSavingScript}>
                      <Save className="mr-2 h-4 w-4" />
                      {isSavingScript ? 'Saving...' : 'Save'}
                    </Button>
                    <Button variant="secondary" onClick={runScript} disabled={isRunningScript || !selectedScript}>
                      <Play className="mr-2 h-4 w-4" />
                      {isRunningScript ? 'Starting run...' : 'Run'}
                    </Button>
                    <Button variant="secondary" onClick={createNewScenario}>
                      <Plus className="mr-2 h-4 w-4" />
                      New
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Find scenario</p>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsScenarioDropdownOpen((value) => !value)}
                          className="flex h-10 w-full items-center justify-between rounded-md border border-white/10 bg-slate-950/50 px-3 py-2 text-left text-sm text-foreground"
                        >
                          <span className="truncate">{selectedScenarioLabel}</span>
                          <span className="text-slate-400">▾</span>
                        </button>
                        {isScenarioDropdownOpen && (
                          <div className="absolute z-20 mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
                            <Input
                              value={scenarioSearch}
                              onChange={(e) => setScenarioSearch(e.target.value)}
                              placeholder="Search scenario by name or id"
                              className="border-white/10 bg-slate-950/70"
                            />
                            <div className="mt-2 rounded-2xl border border-white/10 bg-slate-950/40 p-2">
                              <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-400">
                                <span>{filteredScripts.length} scenario{filteredScripts.length === 1 ? '' : 's'}</span>
                                <span>{scripts.length} total</span>
                              </div>
                              <div className="max-h-72 space-y-2 overflow-auto pr-1">
                              {filteredScripts.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">No scenarios found for your search.</p>}
                              {filteredScripts.map((script) => {
                                const active = script.id === selectedScriptId;
                                return (
                                  <button
                                    key={script.id}
                                    type="button"
                                    onClick={() => chooseScenario(script)}
                                    className={cn(
                                      'flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition-all',
                                      active ? 'bg-primary/15 text-white' : 'text-slate-300 hover:bg-white/[0.04]'
                                    )}
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-medium">{script.name}</span>
                                      <span className="block text-xs text-slate-500">{script.id.slice(0, 8)}</span>
                                    </span>
                                    {active && <Badge className="border-primary/30 bg-primary/20 text-white">Active</Badge>}
                                  </button>
                                );
                              })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      {scriptsError && (
                        <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{scriptsError}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/50 px-3 py-2">
                      <Input
                        value={scriptName}
                        onChange={(e) => setScriptName(e.target.value)}
                        readOnly={!isEditingScenarioName}
                        className="h-auto border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => setIsEditingScenarioName((value) => !value)}
                        className="text-slate-400 transition hover:text-white"
                        aria-label="Edit scenario file name"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {runError && (
                      <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{runError}</span>
                      </div>
                    )}
                    {saveError && (
                      <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{saveError}</span>
                      </div>
                    )}
                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/60 shadow-soft">
                      <Editor
                        height="620px"
                        defaultLanguage="typescript"
                        language="typescript"
                        value={scriptContent}
                        onChange={(value) => setScriptContent(value ?? '')}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          automaticLayout: true,
                          roundedSelection: true,
                          scrollBeyondLastLine: false,
                          padding: { top: 18, bottom: 18 }
                        }}
                        theme="vs-dark"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isDeleteConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsDeleteConfirmOpen(false)}>
              <Card className="w-full max-w-md border-white/10 bg-slate-950" onClick={(event) => event.stopPropagation()}>
                <CardHeader>
                  <CardTitle>Delete scenario?</CardTitle>
                  <CardDescription>This action removes the selected scenario from the list.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setIsDeleteConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      setIsDeleteConfirmOpen(false);
                      await deleteScript();
                    }}
                  >
                    Confirm Delete
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {leftMenu === 'builder' && (
            <Card className="border-white/10 bg-card/90 backdrop-blur">
              <CardHeader>
                <CardTitle>Builder Utility</CardTitle>
                <CardDescription>Open target pages, keep references handy, and organize captured selector metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div>
                      <p className="text-sm font-medium text-white">Target page launcher</p>
                      <p className="mt-1 text-sm text-slate-400">Switch between browse and capture context before opening a target URL.</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
                      <Input value={builderInputUrl} onChange={(e) => setBuilderInputUrl(e.target.value)} placeholder="https://saas.beta.skorpintar.com/" className="border-white/10 bg-slate-950/50" />
                      <Button variant={builderMode === 'browse' ? 'default' : 'secondary'} onClick={() => setBuilderMode('browse')}>
                        <Globe className="mr-2 h-4 w-4" />
                        Browse
                      </Button>
                      <Button variant={builderMode === 'capture' ? 'default' : 'secondary'} onClick={() => setBuilderMode('capture')}>
                        <MousePointerClick className="mr-2 h-4 w-4" />
                        Capture
                      </Button>
                      <Button onClick={openBuilderTarget}>Open URL</Button>
                    </div>
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/30 p-4 text-sm text-slate-400">
                      Open your target URL in a separate tab for normal interaction. Capture tooling has been removed from this app, so this space now focuses on reference management.
                    </div>
                    {builderStatus && <p className="text-sm font-medium text-primary-foreground">{builderStatus}</p>}
                    {builderLastOpenedUrl && (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Last opened URL</p>
                        <p className="mt-2 break-all text-sm text-slate-200">{builderLastOpenedUrl}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">Generated snippet</p>
                        <p className="mt-1 text-sm text-slate-400">Quick-copy helper from the latest captured selector metadata.</p>
                      </div>
                      <Badge className="border-white/10 bg-white/5 text-slate-200">Latest</Badge>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-100">
                      <pre className="overflow-auto whitespace-pre-wrap break-words">{generatedSnippet || 'No snippet available yet.'}</pre>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void copyToClipboard(generatedSnippet || '')} disabled={!generatedSnippet}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Snippet
                    </Button>
                  </div>
                </div>

                <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Captured Selectors</p>
                      <p className="mt-1 text-sm text-slate-400">Stored references for CSS and XPath details.</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setBuilderCaptured([])}>
                      Clear
                    </Button>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {builderCaptured.slice(0, 30).map((item, index) => (
                      <div key={`${item.timestamp}-${index}`} className="rounded-3xl border border-white/10 bg-slate-950/40 p-4 text-sm">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{item.tag}</Badge>
                          <span className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="mb-3 break-all text-sm text-slate-300">{item.url}</p>
                        {item.text && <p className="mb-3 text-sm text-white">Text: {item.text}</p>}
                        {item.css && (
                          <div className="mb-3 flex items-start gap-2">
                            <code className="min-w-0 flex-1 break-all rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200">CSS: {item.css}</code>
                            <Button variant="secondary" size="icon" onClick={() => void copyToClipboard(item.css)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {item.xpath && (
                          <div className="flex items-start gap-2">
                            <code className="min-w-0 flex-1 break-all rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200">XPath: {item.xpath}</code>
                            <Button variant="secondary" size="icon" onClick={() => void copyToClipboard(item.xpath)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {builderCaptured.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-sm text-slate-400">
                      No captured selectors yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {leftMenu === 'test-result' && (
            <Card className="border-white/10 bg-card/90 backdrop-blur">
              <CardHeader>
                <CardTitle>Test Result Center</CardTitle>
                <CardDescription>Track run history, stream logs, and inspect screenshots or video artifacts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {runsError && (
                  <div className="flex items-start gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{runsError}</span>
                  </div>
                )}
                <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/30">
                  <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Script Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Created At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRuns.map((run) => (
                      <TableRow
                        key={run.id}
                        className="cursor-pointer"
                        onClick={() => {
                          window.location.href = `/run/${run.id}`;
                        }}
                      >
                        <TableCell>{run.id.slice(0, 8)}</TableCell>
                        <TableCell>{run.scriptName}</TableCell>
                        <TableCell>
                          <Badge className={statusClassMap[run.status]}>{run.status}</Badge>
                        </TableCell>
                        <TableCell>{formatDuration(run.durationMs)}</TableCell>
                        <TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  </Table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-sm text-slate-400">
                    Showing {(resultsPage - 1) * resultsPageSize + 1}-{Math.min(resultsPage * resultsPageSize, runs.length)} of {runs.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" disabled={resultsPage === 1} onClick={() => setResultsPage((prev) => prev - 1)}>
                      Previous
                    </Button>
                    {Array.from({ length: totalResultsPages }, (_, i) => i + 1).map((pageNum) => (
                      <Button
                        key={pageNum}
                        variant={pageNum === resultsPage ? 'default' : 'secondary'}
                        size="sm"
                        onClick={() => setResultsPage(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    ))}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={resultsPage === totalResultsPages}
                      onClick={() => setResultsPage((prev) => prev + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
        </div>
      </div>
    </main>
  );
}
