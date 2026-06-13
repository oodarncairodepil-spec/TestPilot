'use client';

import dynamic from 'next/dynamic';
import { Copy, Globe, LayoutDashboard, ListChecks, MousePointerClick, PanelLeftClose, PanelLeftOpen, Play, Save, Square, TestTube2, Trash2, WandSparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

type RunDetails = Run & {
  startTime: string | null;
  endTime: string | null;
  finalUrl: string;
  consoleLogs: string[];
  networkFailures: string[];
  metadata: {
    screenshots: string[];
    videos: string[];
    traces: string[];
  } | null;
};

type ArtifactsResponse = {
  files: { path: string; url: string }[];
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


type ArtifactKind = 'image' | 'video' | 'other';
type LeftMenu = 'dashboard' | 'scenario' | 'builder' | 'test-result';
type BuilderMode = 'browse' | 'capture';

const getArtifactKind = (filePath: string): ArtifactKind => {
  const lower = filePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov)$/.test(lower)) return 'video';
  return 'other';
};

const statusClassMap: Record<Run['status'], string> = {
  queued: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  running: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  passed: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
  timeout: 'bg-red-100 text-red-800 hover:bg-red-100',
  cancelled: 'bg-red-100 text-red-800 hover:bg-red-100'
};

const resolveApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
    const isBadLocal =
      configured?.includes('localhost') &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';
    if (configured && !isBadLocal) {
      return configured;
    }
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
};

const resolveWsBase = (): string => {
  if (typeof window !== 'undefined') {
    const configured = process.env.NEXT_PUBLIC_WS_BASE_URL;
    const isBadLocal =
      configured?.includes('localhost') &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1';
    if (configured && !isBadLocal) {
      return configured;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://localhost:4000';
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

const formatDuration = (durationMs: number | null): string => {
  if (!durationMs) return '-';
  return `${(durationMs / 1000).toFixed(2)}s`;
};

const escapeTsString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export default function HomePage() {
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
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetails | null>(null);
  const [resultsPage, setResultsPage] = useState(1);
  const [artifacts, setArtifacts] = useState<ArtifactsResponse | null>(null);
  const [liveLogs, setLiveLogs] = useState('');
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<{
    path: string;
    url: string;
    kind: ArtifactKind;
  } | null>(null);

  const [builderInputUrl, setBuilderInputUrl] = useState('https://saas.beta.skorpintar.com/');
  const [builderMode, setBuilderMode] = useState<BuilderMode>('browse');
  const [builderLastOpenedUrl, setBuilderLastOpenedUrl] = useState('');
  const [builderStatus, setBuilderStatus] = useState('');
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(false);
  const [builderCaptured, setBuilderCaptured] = useState<BuilderSelector[]>([]);
  const [scenarioSearch, setScenarioSearch] = useState('');

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
    const response = await fetch(`${apiBase}/api/scripts`);
    const data = (await response.json()) as { items: Script[] };
    setScripts(data.items);
    if (!selectedScriptId && data.items.length > 0) {
      selectScript(data.items[0]);
    }
  }, [selectedScriptId, apiBase, selectScript]);

  const refreshRuns = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/runs`);
    const data = (await response.json()) as { items: Run[]; stats: typeof stats };
    setRuns(data.items);
    setStats(data.stats);
  }, [apiBase]);

  const loadRunDetails = useCallback(
    async (runId: string) => {
      const [runRes, artifactsRes] = await Promise.all([
        fetch(`${apiBase}/api/run/${runId}`),
        fetch(`${apiBase}/api/artifacts/${runId}`)
      ]);
      setSelectedRun((await runRes.json()) as RunDetails);
      setArtifacts((await artifactsRes.json()) as ArtifactsResponse);
    },
    [apiBase]
  );

  useEffect(() => {
    void refreshScripts();
    void refreshRuns();
    const interval = setInterval(() => {
      void refreshRuns();
      if (selectedRunId) {
        void loadRunDetails(selectedRunId);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [loadRunDetails, refreshRuns, refreshScripts, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) return;
    const ws = new WebSocket(`${wsBase}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', runId: selectedRunId }));
    };
    ws.onmessage = (message) => {
      const payload = JSON.parse(message.data as string) as {
        type: 'log' | 'status';
        stream?: string;
        data: string;
      };
      if (payload.type === 'log') {
        setLiveLogs((current) => `${current}${payload.data}`);
      }
      if (payload.type === 'status') {
        void refreshRuns();
        void loadRunDetails(selectedRunId);
      }
    };
    return () => ws.close();
  }, [loadRunDetails, refreshRuns, selectedRunId, wsBase]);


  const saveScript = async () => {
    if (selectedScript) {
      await fetch(`${apiBase}/api/scripts/${selectedScript.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: scriptName, content: scriptContent })
      });
    } else {
      await fetch(`${apiBase}/api/scripts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: scriptName, content: scriptContent })
      });
    }
    await refreshScripts();
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
    setLiveLogs('');
    const response = await fetch(`${apiBase}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId: selectedScript.id })
    });
    const run = (await response.json()) as Run;
    setSelectedRunId(run.id);
    await refreshRuns();
    await loadRunDetails(run.id);
    setLeftMenu('test-result');
  };

  const stopSelectedRun = async () => {
    if (!selectedRun || (selectedRun.status !== 'queued' && selectedRun.status !== 'running')) {
      return;
    }

    setIsStoppingRun(true);
    try {
      await fetch(`${apiBase}/api/run/${selectedRun.id}/stop`, { method: 'POST' });
    } finally {
      setIsStoppingRun(false);
      await refreshRuns();
      await loadRunDetails(selectedRun.id);
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

  const canStopSelectedRun = selectedRun?.status === 'queued' || selectedRun?.status === 'running';

  useEffect(() => {
    if (resultsPage > totalResultsPages) {
      setResultsPage(totalResultsPages);
    }
  }, [resultsPage, totalResultsPages]);

  return (
    <main className="min-h-screen bg-slate-100 p-4 lg:p-6">
      <div className={`grid gap-4 ${isMenuCollapsed ? 'lg:grid-cols-[80px_minmax(0,1fr)]' : 'lg:grid-cols-[240px_minmax(0,1fr)]'}`}>
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              {!isMenuCollapsed && <CardTitle className="text-base">Menu</CardTitle>}
              <Button variant="ghost" size="icon" onClick={() => setIsMenuCollapsed((v) => !v)} aria-label="Toggle menu">
                {isMenuCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant={leftMenu === 'dashboard' ? 'default' : 'secondary'}
              className="w-full justify-start"
              onClick={() => setLeftMenu('dashboard')}
            >
              <LayoutDashboard className={isMenuCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
              {!isMenuCollapsed && 'Dashboard'}
            </Button>
            <Button
              variant={leftMenu === 'scenario' ? 'default' : 'secondary'}
              className="w-full justify-start"
              onClick={() => setLeftMenu('scenario')}
            >
              <ListChecks className={isMenuCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
              {!isMenuCollapsed && 'Scenario'}
            </Button>
            <Button
              variant={leftMenu === 'builder' ? 'default' : 'secondary'}
              className="w-full justify-start"
              onClick={() => setLeftMenu('builder')}
            >
              <WandSparkles className={isMenuCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
              {!isMenuCollapsed && 'Builder'}
            </Button>
            <Button
              variant={leftMenu === 'test-result' ? 'default' : 'secondary'}
              className="w-full justify-start"
              onClick={() => setLeftMenu('test-result')}
            >
              <TestTube2 className={isMenuCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
              {!isMenuCollapsed && 'Test Result'}
            </Button>
          </CardContent>
        </Card>

        <section className="space-y-4">
          {leftMenu === 'dashboard' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dashboard</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['Total Runs', stats.total],
                    ['Passed Runs', stats.passed],
                    ['Failed Runs', stats.failed],
                    ['Running Runs', stats.running]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border bg-card p-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-2 text-2xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {leftMenu === 'scenario' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scenario</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input value={scriptName} onChange={(e) => setScriptName(e.target.value)} />

                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveScript}>
                    <Save className="mr-2 h-4 w-4" />
                    Save
                  </Button>
                  <Button variant="secondary" onClick={runScript}>
                    <Play className="mr-2 h-4 w-4" />
                    Run
                  </Button>
                  <Button variant="destructive" onClick={deleteScript}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Scenario Selection</p>
                  <Input
                    value={scenarioSearch}
                    onChange={(e) => setScenarioSearch(e.target.value)}
                    placeholder="Search scenario by name or id"
                  />
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    value={selectedScriptId ?? ''}
                    onChange={(e) => {
                      const script = scripts.find((item) => item.id === e.target.value);
                      if (!script) return;
                      selectScript(script);
                    }}
                  >
                    <option value="">Select a scenario</option>
                    {filteredScripts.map((script) => (
                      <option key={script.id} value={script.id}>
                        {script.name}
                      </option>
                    ))}
                  </select>
                  {filteredScripts.length === 0 && (
                    <p className="text-xs text-muted-foreground">No scenarios found for your search.</p>
                  )}
                </div>

                <div className="overflow-hidden rounded-md border">
                  <Editor
                    height="460px"
                    defaultLanguage="typescript"
                    language="typescript"
                    value={scriptContent}
                    onChange={(value) => setScriptContent(value ?? '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      automaticLayout: true
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {leftMenu === 'builder' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Builder</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                  <Input value={builderInputUrl} onChange={(e) => setBuilderInputUrl(e.target.value)} placeholder="https://saas.beta.skorpintar.com/" />
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

                <p className="text-xs text-muted-foreground">
                  Open your target URL in a separate tab for normal interaction. Capture tooling has been removed from this app.
                </p>

                {builderStatus && <p className="text-xs font-medium text-primary">{builderStatus}</p>}
                {builderLastOpenedUrl && <p className="text-xs text-muted-foreground">Target URL: {builderLastOpenedUrl}</p>}

                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Captured Selectors ({builderCaptured.length})</h3>
                    <Button variant="secondary" size="sm" onClick={() => setBuilderCaptured([])}>
                      Clear
                    </Button>
                  </div>

                  {latestCaptured && generatedSnippet && (
                    <div className="space-y-2 rounded-md bg-slate-900 p-3 text-xs text-slate-100">
                      <p className="font-semibold">Generated snippet (latest capture)</p>
                      <pre className="overflow-auto">{generatedSnippet}</pre>
                      <Button variant="secondary" size="sm" onClick={() => void copyToClipboard(generatedSnippet)}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy Snippet
                      </Button>
                    </div>
                  )}

                  <div className="max-h-[420px] space-y-2 overflow-auto">
                    {builderCaptured.slice(0, 30).map((item, index) => (
                      <div key={`${item.timestamp}-${index}`} className="rounded-md border p-3 text-xs">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{item.tag}</Badge>
                          <span className="text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</span>
                          <span className="truncate text-muted-foreground">{item.url}</span>
                        </div>
                        {item.text && <p className="mb-1 text-sm">Text: {item.text}</p>}
                        {item.css && (
                          <div className="mb-1 flex items-start gap-2">
                            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1">CSS: {item.css}</code>
                            <Button variant="secondary" size="sm" onClick={() => void copyToClipboard(item.css)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {item.xpath && (
                          <div className="flex items-start gap-2">
                            <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1">XPath: {item.xpath}</code>
                            <Button variant="secondary" size="sm" onClick={() => void copyToClipboard(item.xpath)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {builderCaptured.length === 0 && <p className="text-xs text-muted-foreground">No captured selectors yet.</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {leftMenu === 'test-result' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Test Result</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                      <TableRow key={run.id} className="cursor-pointer" onClick={() => setSelectedRunId(run.id)}>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
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

                {selectedRun && (
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Result Viewer</h3>
                      {canStopSelectedRun && (
                        <Button variant="destructive" onClick={stopSelectedRun} disabled={isStoppingRun}>
                          <Square className="mr-2 h-4 w-4" />
                          {isStoppingRun ? 'Stopping...' : 'Stop Run'}
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <p>Status: {selectedRun.status}</p>
                      <p>Execution Time: {formatDuration(selectedRun.durationMs)}</p>
                      <p>Start Time: {selectedRun.startTime ?? '-'}</p>
                      <p>End Time: {selectedRun.endTime ?? '-'}</p>
                      <p className="sm:col-span-2">Final URL: {selectedRun.finalUrl || '-'}</p>
                      <p>Console Logs: {selectedRun.consoleLogs.length}</p>
                      <p>Network Errors: {selectedRun.networkFailures.length}</p>
                    </div>

                    <p className="text-xs text-muted-foreground">Open `dashboard-loaded.png` or `video.webm` from artifacts.</p>

                    <pre className="max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{liveLogs || 'No live logs yet.'}</pre>

                    {artifacts && (
                      <div className="space-y-1">
                        {artifacts.files.map((file) => {
                          const kind = getArtifactKind(file.path);
                          const url = apiBase + file.url;
                          return (
                            <button
                              key={file.path}
                              type="button"
                              className="block w-full rounded-sm px-2 py-1 text-left text-sm text-primary hover:bg-muted"
                              onClick={() => {
                                if (kind === 'other') {
                                  window.open(url, '_blank', 'noopener,noreferrer');
                                  return;
                                }
                                setPreviewArtifact({ path: file.path, url, kind });
                              }}
                            >
                              {file.path}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {previewArtifact && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewArtifact(null)}>
                    <Card className="max-h-[90vh] w-full max-w-6xl overflow-auto" onClick={(event) => event.stopPropagation()}>
                      <CardHeader className="flex-row items-center justify-between space-y-0">
                        <CardTitle className="text-sm">{previewArtifact.path}</CardTitle>
                        <Button variant="secondary" onClick={() => setPreviewArtifact(null)}>
                          Close
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {previewArtifact.kind === 'image' ? (
                          <img className="max-h-[75vh] w-full rounded-md bg-slate-900 object-contain" src={previewArtifact.url} alt={previewArtifact.path} />
                        ) : (
                          <video className="max-h-[75vh] w-full rounded-md bg-slate-900 object-contain" src={previewArtifact.url} controls autoPlay />
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
