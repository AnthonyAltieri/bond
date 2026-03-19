import type { Tool } from '@bond/tool-runtime';
import { createShellTool } from '@bond/tool-shell';

export function createLocalToolset(): Tool[] {
  return [createShellTool()];
}
