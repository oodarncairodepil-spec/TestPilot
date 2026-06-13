'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

type ArtifactKind = 'image' | 'video' | 'other';

const getArtifactKind = (filePath: string): ArtifactKind => {
  const lower = filePath.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov)$/.test(lower)) return 'video';
  return 'other';
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

export default function HomePage() {
  const apiBase = useMemo(() => resolveApiBase(), []);
  const wsBase = useMemo(() => resolveWsBase(), []);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, running: 0 });
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState('skorpintar-login.spec.ts');
  const [scriptContent, setScriptContent] = useState(seededTest);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetails | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactsResponse | null>(null);
  const [liveLogs, setLiveLogs] = useState('');
  const [isStoppingRun, setIsStoppingRun] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<{
    path: string;
    url: string;
    kind: ArtifactKind;
  } | null>(null);

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedScriptId) ?? null,
    [scripts, selectedScriptId]
  );

  const refreshScripts = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/scripts`);
    const data = (await response.json()) as { items: Script[] };
    setScripts(data.items);
    if (!selectedScriptId && data.items.length > 0) {
      setSelectedScriptId(data.items[0].id);
      setScriptName(data.items[0].name);
      setScriptContent(data.items[0].content);
    }
  }, [selectedScriptId, apiBase]);

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

  const canStopSelectedRun = selectedRun?.status === 'queued' || selectedRun?.status === 'running';

  return (
    <main className="page">
      <div className="panel">
        <h2>Dashboard</h2>
        <div className="stats">
          <div className="stat">
            <div className="label">Total Runs</div>
            <div className="value">{stats.total}</div>
          </div>
          <div className="stat">
            <div className="label">Passed Runs</div>
            <div className="value">{stats.passed}</div>
          </div>
          <div className="stat">
            <div className="label">Failed Runs</div>
            <div className="value">{stats.failed}</div>
          </div>
          <div className="stat">
            <div className="label">Running Runs</div>
            <div className="value">{stats.running}</div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 12 }}>
        <section className="panel">
          <h2>Scripts</h2>
          <div className="row">
            <input value={scriptName} onChange={(e) => setScriptName(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn" onClick={saveScript}>
              Save
            </button>
            <button className="btn secondary" onClick={runScript}>
              Run
            </button>
            <button className="btn warn" onClick={deleteScript}>
              Delete
            </button>
          </div>
          <div className="list">
            {scripts.map((script) => (
              <button
                key={script.id}
                className={`list-item ${script.id === selectedScriptId ? 'active' : ''}`}
                onClick={() => {
                  setSelectedScriptId(script.id);
                  setScriptName(script.name);
                  setScriptContent(script.content);
                }}
              >
                {script.name}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Editor
              height="360px"
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
        </section>

        <section className="panel">
          <h2>Runs</h2>
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Script Name</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} onClick={() => setSelectedRunId(run.id)} style={{ cursor: 'pointer' }}>
                  <td>{run.id.slice(0, 8)}</td>
                  <td>{run.scriptName}</td>
                  <td>
                    <span className={`badge ${run.status}`}>{run.status}</span>
                  </td>
                  <td>{formatDuration(run.durationMs)}</td>
                  <td>{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedRun && (
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Result Viewer</h2>
                {canStopSelectedRun && (
                  <button className="btn warn" onClick={stopSelectedRun} disabled={isStoppingRun}>
                    {isStoppingRun ? 'Stopping...' : 'Stop Run'}
                  </button>
                )}
              </div>
              <div className="row">Status: {selectedRun.status}</div>
              <div className="row">Execution Time: {formatDuration(selectedRun.durationMs)}</div>
              <div className="row">Start Time: {selectedRun.startTime ?? '-'}</div>
              <div className="row">End Time: {selectedRun.endTime ?? '-'}</div>
              <div className="row">Final URL: {selectedRun.finalUrl || '-'}</div>
              <div className="row">Console Logs: {selectedRun.consoleLogs.length}</div>
              <div className="row">Network Errors: {selectedRun.networkFailures.length}</div>
              <div className="row">Open `login-success-homepage.png` or `video.webm` from artifacts.</div>
              <div className="logs">{liveLogs || 'No live logs yet.'}</div>

              {artifacts && (
                <div className="artifacts" style={{ marginTop: 10 }}>
                  {artifacts.files.map((file) => {
                    const kind = getArtifactKind(file.path);
                    const url = apiBase + file.url;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        className="artifact-link"
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

              {previewArtifact && (
                <div className="artifact-modal" onClick={() => setPreviewArtifact(null)}>
                  <div className="artifact-modal-content" onClick={(event) => event.stopPropagation()}>
                    <div className="artifact-modal-header">
                      <strong>{previewArtifact.path}</strong>
                      <button type="button" className="btn secondary" onClick={() => setPreviewArtifact(null)}>
                        Close
                      </button>
                    </div>
                    {previewArtifact.kind === 'image' ? (
                      <img className="artifact-image" src={previewArtifact.url} alt={previewArtifact.path} />
                    ) : (
                      <video className="artifact-video" src={previewArtifact.url} controls autoPlay />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
