import { randomUUID } from 'node:crypto';

import type { ExecCommandResponse, ExecSessionManager } from './services.ts';
import { truncateByApproxTokens } from './shared/workspace.ts';

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250;

interface RunningExecSession {
  buffer: string;
  child: ReturnType<typeof Bun.spawn>;
  exitCode?: number;
  exited: boolean;
  readOffset: number;
}

export function createInMemoryExecSessionManager(): ExecSessionManager {
  let nextSessionId = 1;
  const sessions = new Map<number, RunningExecSession>();

  return {
    async execCommand(request) {
      const sessionId = nextSessionId;
      nextSessionId += 1;

      const child = Bun.spawn(
        [request.shell ?? '/bin/sh', request.login === false ? '-c' : '-lc', request.cmd],
        { cwd: request.workdir, stderr: 'pipe', stdin: 'pipe', stdout: 'pipe' },
      );
      const session: RunningExecSession = { buffer: '', child, exited: false, readOffset: 0 };
      sessions.set(sessionId, session);

      const onChunk = (chunk: string) => {
        session.buffer += chunk;
      };
      void pumpStream(child.stdout, onChunk);
      void pumpStream(child.stderr, onChunk);
      void child.exited.then((exitCode) => {
        session.exited = true;
        session.exitCode = exitCode;
      });

      const response = await collectExecResponse(
        session,
        sessionId,
        request.maxOutputTokens,
        request.yieldTimeMs ?? DEFAULT_EXEC_YIELD_TIME_MS,
      );

      if (session.exited) {
        sessions.delete(sessionId);
      }

      return response;
    },
    async writeStdin(request) {
      const session = sessions.get(request.sessionId);

      if (!session) {
        throw new Error(`Unknown exec session ${String(request.sessionId)}`);
      }

      if (request.chars && isWritableStdin(session.child.stdin)) {
        await session.child.stdin.write(request.chars);
      }

      const response = await collectExecResponse(
        session,
        request.sessionId,
        request.maxOutputTokens,
        request.yieldTimeMs ?? DEFAULT_WRITE_STDIN_YIELD_TIME_MS,
      );

      if (session.exited) {
        sessions.delete(request.sessionId);
      }

      return response;
    },
  };
}

async function collectExecResponse(
  session: RunningExecSession,
  sessionId: number,
  maxOutputTokens: number | undefined,
  yieldTimeMs: number,
): Promise<ExecCommandResponse> {
  const startedAt = Date.now();
  const startedReadOffset = session.readOffset;
  await Promise.race([sleep(yieldTimeMs), session.child.exited]);
  const unread = session.buffer.slice(startedReadOffset);
  session.readOffset = session.buffer.length;
  const truncated = truncateByApproxTokens(unread, maxOutputTokens);

  return {
    chunkId: randomUUID(),
    exitCode: session.exited ? session.exitCode : undefined,
    originalTokenCount: truncated.originalTokenCount,
    output: truncated.output,
    sessionId: session.exited ? undefined : sessionId,
    wallTimeSeconds: (Date.now() - startedAt) / 1000,
  };
}

async function pumpStream(
  stream: ReadableStream<Uint8Array> | null,
  onChunk: (chunk: string) => void,
): Promise<void> {
  if (!stream) {
    return;
  }

  const decoder = new TextDecoder();
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      const finalChunk = decoder.decode();

      if (finalChunk) {
        onChunk(finalChunk);
      }

      return;
    }

    const chunk = decoder.decode(value, { stream: true });

    if (chunk) {
      onChunk(chunk);
    }
  }
}

function isWritableStdin(
  stdin: RunningExecSession['child']['stdin'],
): stdin is Exclude<RunningExecSession['child']['stdin'], number | null | undefined> {
  return stdin !== undefined && stdin !== null && typeof stdin !== 'number';
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}
