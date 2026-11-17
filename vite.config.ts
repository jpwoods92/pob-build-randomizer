import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { getLocalPobCommit, parseGameVersionsLua, readLocalDataSnapshot } from './scripts/pob-version.mjs';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const nodeBinDir = dirname(process.execPath);
const runEnv = {
  ...process.env,
  PATH: `${nodeBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

const UPSTREAM_GAME_VERSIONS_URL =
  'https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/master/src/GameVersions.lua';
const UPSTREAM_POB_REPO = 'https://github.com/PathOfBuildingCommunity/PathOfBuilding.git';

function sendJson(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBodyJson(req: Connect.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function checkUpstreamStatus() {
  const local = readLocalDataSnapshot(root);
  const localCommit = await getLocalPobCommit(root);

  let upstreamVersion: string | null = null;
  let upstreamDisplay: string | null = null;
  let upstreamCommit: string | null = null;
  let offline = false;

  const [luaRes, gitRes] = await Promise.allSettled([
    fetch(UPSTREAM_GAME_VERSIONS_URL, { signal: AbortSignal.timeout(4000) }),
    execFileAsync('git', ['ls-remote', UPSTREAM_POB_REPO, 'refs/heads/master'], {
      cwd: root,
      env: runEnv,
      timeout: 4000,
    }),
  ]);

  if (luaRes.status === 'fulfilled' && luaRes.value.ok) {
    const parsed = parseGameVersionsLua(await luaRes.value.text());
    upstreamVersion = parsed.version;
    upstreamDisplay = parsed.display;
  } else {
    offline = true;
  }

  if (gitRes.status === 'fulfilled') {
    const sha = gitRes.value.stdout.trim().split(/\s+/)[0];
    if (sha) upstreamCommit = sha;
  }

  const versionChanged = Boolean(upstreamVersion && upstreamVersion !== local.version);
  const commitsChanged = Boolean(localCommit && upstreamCommit && localCommit !== upstreamCommit);

  return {
    ok: true,
    canSync: true,
    offline,
    localVersion: local.version,
    localDisplay: local.display,
    upstreamVersion,
    upstreamDisplay,
    localCommit: localCommit?.slice(0, 7) ?? null,
    upstreamCommit: upstreamCommit?.slice(0, 7) ?? null,
    versionChanged,
    commitsChanged,
    updateAvailable: versionChanged || commitsChanged,
  };
}

function attachPobSyncMiddleware(middlewares: Connect.Server) {
  let syncing = false;

  middlewares.use('/api/pob-status', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      sendJson(res, 200, await checkUpstreamStatus());
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  middlewares.use('/api/pob-sync', async (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (syncing) {
      sendJson(res, 409, { ok: false, error: 'A PoB sync is already running.' });
      return;
    }

    syncing = true;
    try {
      const body = await readBodyJson(req);
      const offlineMode = body.offline === true;
      const before = readLocalDataSnapshot(root);

      if (!offlineMode) {
        try {
          await execFileAsync(process.execPath, [join(root, 'scripts/fetch-data.mjs')], {
            cwd: root,
            env: runEnv,
            timeout: 120_000,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendJson(res, 502, {
            ok: false,
            offlineError: true,
            error: `Could not reach upstream PoB/tree repositories (${msg.split('\n')[0]}).`,
          });
          return;
        }
      }

      await execFileAsync(process.execPath, [join(root, 'scripts/build-data.mjs')], {
        cwd: root,
        env: runEnv,
        timeout: 120_000,
      });

      const after = readLocalDataSnapshot(root);
      const changed =
        after.version !== before.version ||
        after.nodes !== before.nodes ||
        after.gems !== before.gems ||
        after.bases !== before.bases ||
        after.mods !== before.mods ||
        after.uniques !== before.uniques ||
        after.minions !== before.minions;

      sendJson(res, 200, { ok: true, offlineMode, before, after, changed });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      syncing = false;
    }
  });
}

function pobSyncPlugin(): Plugin {
  return {
    name: 'pob-sync-api',
    configureServer(server) {
      attachPobSyncMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachPobSyncMiddleware(server.middlewares);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [pobSyncPlugin()],
  server: {
    port: 5174,
    open: false,
  },
  build: {
    target: 'esnext',
  },
});
