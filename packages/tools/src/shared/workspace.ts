import { isAbsolute, relative, resolve } from 'node:path';

import type { ToolExecutionContext } from '../types.ts';

export function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const pathRelativeToRoot = relative(workspaceRoot, targetPath);

  return (
    pathRelativeToRoot === '' ||
    (!pathRelativeToRoot.startsWith('..') && !isAbsolute(pathRelativeToRoot))
  );
}

export function normalizeTimeout(timeoutMs: number | undefined, defaultTimeoutMs: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return defaultTimeoutMs;
  }

  return Math.floor(timeoutMs);
}

export function resolveWorkspacePath(
  value: string | undefined,
  context: ToolExecutionContext,
): string {
  const targetPath = value ? resolve(context.workspaceRoot, value) : resolve(context.cwd);

  if (!isInsideWorkspace(context.workspaceRoot, targetPath)) {
    throw new Error('path must stay inside the workspace root');
  }

  return targetPath;
}

export function truncateByApproxTokens(
  value: string,
  maxOutputTokens: number | undefined,
): { originalTokenCount: number; output: string } {
  const originalTokenCount = Math.ceil(value.length / 4);

  if (
    typeof maxOutputTokens !== 'number' ||
    !Number.isFinite(maxOutputTokens) ||
    maxOutputTokens <= 0
  ) {
    return { originalTokenCount, output: value };
  }

  const maxChars = Math.max(Math.floor(maxOutputTokens) * 4, 0);

  if (value.length <= maxChars) {
    return { originalTokenCount, output: value };
  }

  return { originalTokenCount, output: `${value.slice(0, maxChars)}...` };
}
