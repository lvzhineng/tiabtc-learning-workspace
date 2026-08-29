export type LocalUiState = Record<string, unknown>;

export function readLocalUiState(storageKey: string): LocalUiState {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) || 'null'
    ) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as LocalUiState)
      : {};
  } catch {
    return {};
  }
}

export function writeLocalUiState(
  storageKey: string,
  state: LocalUiState
): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The workspace remains usable when browser storage is unavailable.
  }
}

export function storedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function storedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum = 100_000
): number {
  return Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : fallback;
}

export function storedString(
  value: unknown,
  fallback: string,
  allowedValues?: readonly string[],
  maximumLength = 200
): string {
  if (typeof value !== 'string' || value.length > maximumLength) return fallback;
  if (allowedValues && !allowedValues.includes(value)) return fallback;
  return value;
}
