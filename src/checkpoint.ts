import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ExportState {
  conversationType: string;
  chatId: string;
  lastMessageId?: string;
  messagesProcessed: number;
  startedAt: string;
  updatedAt: string;
}

const STATE_FILENAME = '.groupme-export-state.json';

export function getStatePath(outputDir: string): string {
  return path.join(outputDir, STATE_FILENAME);
}

export function loadState(outputDir: string): ExportState | null {
  const statePath = getStatePath(outputDir);
  if (!fs.existsSync(statePath)) { return null; }
  try {
    const data = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(data) as ExportState;
  } catch {
    return null;
  }
}

export function saveState(outputDir: string, state: ExportState): void {
  const statePath = getStatePath(outputDir);
  // Write temp file in same directory to avoid cross-filesystem rename failures (EXDEV)
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = path.join(path.dirname(statePath), `.groupme-state-${Date.now()}.tmp`);
  // Atomic write: write to temp, then rename
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, statePath);
}

export function clearState(outputDir: string): void {
  const statePath = getStatePath(outputDir);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}
