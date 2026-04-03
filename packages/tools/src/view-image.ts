import { extname } from 'node:path';

import { readFile, stat } from 'node:fs/promises';

import type { Tool } from './types.ts';
import { getOptionalString, parseJsonObject } from './shared/json.ts';
import { resolveWorkspacePath } from './shared/workspace.ts';

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

export function createViewImageTool(): Tool {
  return {
    definition: {
      description:
        'View a local image from the filesystem so you can inspect its visual contents directly. Use this when the task depends on what an image shows rather than its filename or metadata, and only when the user provided a full filepath or the image is already known locally.',
      inputSchema: {
        additionalProperties: false,
        properties: { detail: { enum: ['original'], type: 'string' }, path: { type: 'string' } },
        required: ['path'],
        type: 'object',
      },
      kind: 'function',
      name: 'functions.view_image',
    },
    async execute(inputText, context) {
      const parsed = parseJsonObject(inputText, 'functions.view_image');
      const rawPath = getOptionalString(parsed, 'path');

      if (!rawPath) {
        throw new Error('input requires a non-empty "path" string');
      }

      const detail = getOptionalString(parsed, 'detail');

      if (detail !== undefined && detail !== 'original') {
        throw new Error(
          `functions.view_image detail only supports "original"; omit it for default behavior, got "${detail}"`,
        );
      }

      const resolvedPath = resolveWorkspacePath(rawPath, context);
      const fileStat = await stat(resolvedPath).catch(() => null);

      if (!fileStat) {
        throw new Error(`Image file not found: ${resolvedPath}`);
      }

      if (fileStat.isDirectory()) {
        throw new Error(`Image path points to a directory: ${resolvedPath}`);
      }

      const extension = extname(resolvedPath).toLowerCase();

      if (!IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported image file type: ${resolvedPath}`);
      }

      const imageBytes = await readFile(resolvedPath);
      const mimeType = toImageMimeType(extension);
      const imageUrl = `data:${mimeType};base64,${Buffer.from(imageBytes).toString('base64')}`;
      const result = { detail: detail ?? null, image_url: imageUrl };

      return {
        content: JSON.stringify(result, null, 2),
        metadata: result,
        name: 'functions.view_image',
        output: [{ detail: detail ?? null, image_url: imageUrl, type: 'input_image' }],
        summary: resolvedPath,
      };
    },
    async *stream(inputText, context) {
      yield* [];
      return await this.execute(inputText, context);
    },
  };
}

function toImageMimeType(extension: string): string {
  switch (extension) {
    case '.gif':
      return 'image/gif';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
