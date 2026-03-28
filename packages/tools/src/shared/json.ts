export function parseJsonObject(inputText: string, toolName: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(inputText);
  } catch {
    throw new Error(`${toolName} input must be valid JSON`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${toolName} input must be an object`);
  }

  return parsed as Record<string, unknown>;
}

export function getOptionalArray(
  source: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`input "${key}" must be an array`);
  }

  return value;
}

export function getOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`input "${key}" must be a boolean`);
  }

  return value;
}

export function getOptionalNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`input "${key}" must be a finite number`);
  }

  return value;
}

export function getOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`input "${key}" must be a string`);
  }

  return value;
}

export function getRequiredString(source: Record<string, unknown>, key: string): string {
  const value = getOptionalString(source, key);

  if (!value) {
    throw new Error(`input requires a non-empty "${key}" string`);
  }

  return value;
}
