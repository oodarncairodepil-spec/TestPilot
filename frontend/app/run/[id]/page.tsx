'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ChevronDown, ChevronRight, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Run = {
  id: string;
  scriptName: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'timeout' | 'cancelled';
  durationMs: number | null;
  createdAt: string;
};

type RunDetails = Run & {
  scriptId?: string;
  scriptContent?: string | null;
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

type FlowStep = {
  id: string;
  flowId: string;
  kind: string;
  value: string | null;
  locators: unknown[];
  meta: Record<string, unknown> | null;
  title: string | null;
  expectedResult: Record<string, unknown> | null;
  typeDelayMs: number | null;
  orderIndex: number | null;
  createdAt: string;
};

type ArtifactsResponse = {
  files: { path: string; url: string }[];
};

type LogsResponse = {
  stdout: string;
  stderr: string;
  entries: {
    type: 'log' | 'status';
    message: string;
  }[];
};

type ArtifactKind = 'image' | 'video' | 'json' | 'other';
type BrowserTab = 'chromium' | 'firefox' | 'webkit';

const getArtifactKind = (filePath: string): ArtifactKind => {
  const lower = filePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov)$/.test(lower)) return 'video';
  if (/\.json$/.test(lower)) return 'json';
  return 'other';
};

const statusClassMap: Record<Run['status'], string> = {
  queued: 'border-amber-500/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/15',
  running: 'border-sky-500/30 bg-sky-500/15 text-sky-200 hover:bg-sky-500/15',
  passed: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15',
  failed: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/15',
  timeout: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/15',
  cancelled: 'border-slate-500/30 bg-slate-500/20 text-slate-200 hover:bg-slate-500/20'
};

const resolveApiBase = (): string => process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://x300.taila1632d.ts.net:4000';

const resolveWsBase = (): string => process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://x300.taila1632d.ts.net:4000';

const formatDuration = (durationMs: number | null): string => {
  if (!durationMs) return '-';
  return `${(durationMs / 1000).toFixed(2)}s`;
};

const getArtifactLabel = (filePath: string, kind: ArtifactKind, index: number): string => {
  if (kind === 'image') return `Screenshot ${index + 1}`;
  if (kind === 'video') return `Video ${index + 1}`;
  if (kind === 'json') return `JSON ${index + 1}`;
  return `Other ${index + 1}`;
};

const getFileName = (filePath: string): string => filePath.split('/').pop() ?? filePath;

const loadArtifactPreview = async (
  file: ArtifactsResponse['files'][number],
  apiBase: string,
  setSelectedArtifactPath: (path: string) => void,
  setPreviewArtifact: (artifact: { path: string; url: string; kind: ArtifactKind; content?: string } | null) => void
) => {
  const kind = getArtifactKind(file.path);
  if (kind === 'other') {
    return;
  }

  setSelectedArtifactPath(file.path);
  const url = apiBase + file.url;

  if (kind === 'json') {
    const response = await fetch(url);
    const content = await response.text();
    setPreviewArtifact({ path: file.path, url, kind, content });
    return;
  }

  setPreviewArtifact({ path: file.path, url, kind });
};

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params.id;
  const apiBase = useMemo(() => resolveApiBase(), []);
  const wsBase = useMemo(() => resolveWsBase(), []);
  const [run, setRun] = useState<RunDetails | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactsResponse | null>(null);
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [liveLogs, setLiveLogs] = useState('');
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [selectedBrowserTab, setSelectedBrowserTab] = useState<BrowserTab>('chromium');
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [expandedArtifactSections, setExpandedArtifactSections] = useState<Record<ArtifactKind, boolean>>({
    image: false,
    video: false,
    json: false,
    other: false
  });
  const [previewArtifact, setPreviewArtifact] = useState<{
    path: string;
    url: string;
    kind: ArtifactKind;
    content?: string;
  } | null>(null);

  const browserTabs: BrowserTab[] = ['chromium', 'firefox', 'webkit'];

  const artifactsByBrowser = useMemo(() => {
    const grouped: Record<BrowserTab, ArtifactsResponse['files']> = {
      chromium: [],
      firefox: [],
      webkit: []
    };

    for (const file of artifacts?.files ?? []) {
      if (file.path.includes('chromium')) {
        grouped.chromium.push(file);
        continue;
      }
      if (file.path.includes('firefox')) {
        grouped.firefox.push(file);
        continue;
      }
      if (file.path.includes('webkit')) {
        grouped.webkit.push(file);
      }
    }

    return grouped;
  }, [artifacts]);

  const selectedBrowserArtifacts = artifactsByBrowser[selectedBrowserTab];

  const selectedArtifact = useMemo(() => {
    if (!selectedArtifactPath) {
      return null;
    }
    return selectedBrowserArtifacts.find((file) => file.path === selectedArtifactPath) ?? null;
  }, [selectedArtifactPath, selectedBrowserArtifacts]);

  const artifactSections = useMemo(() => {
    const grouped: Record<ArtifactKind, ArtifactsResponse['files']> = {
      image: [],
      video: [],
      json: [],
      other: []
    };

    for (const file of selectedBrowserArtifacts) {
      grouped[getArtifactKind(file.path)].push(file);
    }

    return grouped;
  }, [selectedBrowserArtifacts]);

  useEffect(() => {
    setExpandedArtifactSections({
      image: false,
      video: false,
      json: false,
      other: false
    });
  }, [selectedBrowserTab]);

  const loadRunDetails = useCallback(async () => {
    const [runRes, artifactsRes, logsRes] = await Promise.all([
      fetch(`${apiBase}/api/run/${runId}`),
      fetch(`${apiBase}/api/artifacts/${runId}`),
      fetch(`${apiBase}/api/logs/${runId}`)
    ]);
    const runData = (await runRes.json()) as RunDetails;
    const artifactsData = (await artifactsRes.json()) as ArtifactsResponse;
    const logsData = (await logsRes.json()) as LogsResponse;

    setRun(runData);
    setArtifacts(artifactsData);

    const persistedLogs = (logsData.entries ?? [])
      .filter((entry) => entry.type === 'log')
      .map((entry) => entry.message)
      .join('');

    setLiveLogs(persistedLogs || `${logsData.stdout ?? ''}${logsData.stderr ?? ''}`);

    if (!runData.scriptId) {
      setSteps([]);
      return;
    }

    const stepsRes = await fetch(`${apiBase}/api/script/${runData.scriptId}/steps`);
    if (!stepsRes.ok) {
      setSteps([]);
      return;
    }

    const stepsData = (await stepsRes.json()) as { items: FlowStep[] };
    setSteps(stepsData.items);
  }, [apiBase, runId]);

  useEffect(() => {
    void loadRunDetails();
  }, [loadRunDetails]);

  useEffect(() => {
    const ws = new WebSocket(`${wsBase}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', runId }));
    };
    ws.onmessage = (message) => {
      const payload = JSON.parse(message.data as string) as {
        type: 'log' | 'status';
        data: string;
      };
      if (payload.type === 'log') {
        setLiveLogs((current) => `${current}${payload.data}`);
      }
      if (payload.type === 'status') {
        void loadRunDetails();
      }
    };
    return () => ws.close();
  }, [loadRunDetails, runId, wsBase]);

  const stopRun = async () => {
    if (!run || (run.status !== 'queued' && run.status !== 'running')) {
      return;
    }

    setIsStoppingRun(true);
    try {
      await fetch(`${apiBase}/api/run/${run.id}/stop`, { method: 'POST' });
    } finally {
      setIsStoppingRun(false);
      await loadRunDetails();
    }
  };

  if (!run) {
    return (
      <main className="min-h-screen px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1600px]">
          <Card className="border-white/10 bg-card/90 backdrop-blur">
            <CardContent className="pt-6 text-sm text-slate-300">Loading run details...</CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const canStop = run.status === 'queued' || run.status === 'running';

  return (
    <main className="min-h-screen px-4 py-6 lg:px-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => router.push('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          {canStop && (
            <Button variant="destructive" onClick={stopRun} disabled={isStoppingRun}>
              <Square className="mr-2 h-4 w-4" />
              {isStoppingRun ? 'Stopping...' : 'Stop Run'}
            </Button>
          )}
        </div>

        <Card className="border-white/10 bg-card/90 backdrop-blur">
          <CardHeader>
            <CardTitle>Run Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Run ID</p>
                <p className="mt-2 break-all text-sm text-slate-100">{run.id}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Script</p>
                <p className="mt-2 text-sm text-slate-100">{run.scriptName}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Duration</p>
                <p className="mt-2 text-sm text-slate-100">{formatDuration(run.durationMs)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p>
                <div className="mt-2">
                  <Badge className={statusClassMap[run.status]}>{run.status}</Badge>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Created</p>
                <p className="mt-2 text-sm text-slate-100">{new Date(run.createdAt).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Start</p>
                <p className="mt-2 break-all text-sm text-slate-100">{run.startTime ?? '-'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">End</p>
                <p className="mt-2 break-all text-sm text-slate-100">{run.endTime ?? '-'}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Final URL</p>
                <p className="mt-2 break-all text-sm text-slate-100">{run.finalUrl || '-'}</p>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Code</p>
                <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100">
                  <pre className="overflow-auto whitespace-pre-wrap break-words">{run.scriptContent || 'No code available for this run.'}</pre>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Steps flow</p>
                <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100">
                  {steps.length === 0 ? (
                    <p className="text-sm text-slate-400">No steps available for this flow.</p>
                  ) : (
                    <div className="space-y-3">
                      {steps.map((step, index) => (
                        <div key={step.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Step {index + 1}</span>
                            <Badge variant="secondary">{step.kind}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-slate-100">{step.title || step.value || 'Untitled step'}</p>
                          {step.value && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-400">{step.value}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Live logs</p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100">{liveLogs || 'No live logs yet.'}</pre>
            </div>

            {artifacts && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-white">Artifacts</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {browserTabs.map((browser) => (
                    <Button
                      key={browser}
                      type="button"
                      variant={selectedBrowserTab === browser ? 'default' : 'secondary'}
                      className="w-full"
                      onClick={() => {
                        setSelectedBrowserTab(browser);
                        setPreviewArtifact(null);
                      }}
                    >
                      {browser}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-3 rounded-3xl border border-white/10 bg-slate-950/40 p-2">
                    {(['image', 'video', 'json', 'other'] as ArtifactKind[]).map((section) => (
                      <div key={section} className="rounded-2xl border border-white/5 bg-white/[0.02]">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left"
                          onClick={() => {
                            const nextExpanded = !expandedArtifactSections[section];
                            setExpandedArtifactSections((current) => ({
                              ...current,
                              [section]: nextExpanded
                            }));
                          }}
                        >
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{section}({artifactSections[section].length})</span>
                          {expandedArtifactSections[section] ? (
                            <ChevronDown className="h-4 w-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-500" />
                          )}
                        </button>
                        {expandedArtifactSections[section] && (
                          <div className="space-y-1 px-2 pb-2">
                            {artifactSections[section].length === 0 ? (
                              <p className="px-2 py-1 text-xs text-slate-500">No {section} files</p>
                            ) : (
                              artifactSections[section].map((file, index) => {
                                const kind = getArtifactKind(file.path);
                                const isSelectable = kind !== 'other';

                                return (
                                  <button
                                    key={file.path}
                                    type="button"
                                    disabled={!isSelectable}
                                    className={
                                      isSelectable
                                        ? 'block w-full rounded-xl px-2 py-2 text-left text-xs text-slate-200 transition hover:bg-white/[0.06]'
                                        : 'block w-full cursor-not-allowed rounded-xl px-2 py-2 text-left text-xs text-slate-500 opacity-60'
                                    }
                                    onClick={async () => {
                                      if (!isSelectable) {
                                        return;
                                      }
                                      await loadArtifactPreview(file, apiBase, setSelectedArtifactPath, setPreviewArtifact);
                                    }}
                                  >
                                    {getArtifactLabel(file.path, kind, index)}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 lg:p-6">
                    {!selectedArtifact || !previewArtifact ? (
                      <div className="flex min-h-[420px] items-center justify-center text-sm text-slate-400">
                        Select an image, video, or json file to preview it here.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm font-medium text-white">{getFileName(previewArtifact.path)}</p>
                        {previewArtifact.kind === 'image' ? (
                          <img className="max-h-[80vh] w-full rounded-md bg-slate-900 object-contain" src={previewArtifact.url} alt={previewArtifact.path} />
                        ) : previewArtifact.kind === 'video' ? (
                          <video className="max-h-[80vh] w-full rounded-md bg-slate-900 object-contain" src={previewArtifact.url} controls autoPlay />
                        ) : (
                          <pre className="max-h-[80vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950/80 p-4 text-xs text-slate-100">
                            {previewArtifact.content}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {selectedBrowserArtifacts.length === 0 && (
                  <p className="text-sm text-slate-400">No artifacts available for {selectedBrowserTab}.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
