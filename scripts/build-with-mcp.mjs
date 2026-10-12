import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Generated output only: avoid retaining legacy static output beside client/.
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
for (const args of [['build', '--outDir', 'dist/client'], ['build', '--config', 'vite.mcp.config.ts']]) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
