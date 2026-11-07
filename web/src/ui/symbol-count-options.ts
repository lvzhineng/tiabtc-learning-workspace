export type SymbolCountOption = { symbol: string; count: number };

/** Count before the symbol filter; retain zero-count options for stable selection. */
export function buildSymbolCountOptions<T>(
  records: readonly T[],
  getSymbol: (record: T) => string,
  allSymbols: readonly string[]
): SymbolCountOption[] {
  const counts = new Map(allSymbols.map((symbol) => [symbol, 0]));
  for (const record of records) {
    const symbol = getSymbol(record);
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return [...counts].map(([symbol, count]) => ({ symbol, count }))
    .sort((left, right) => right.count - left.count || left.symbol.localeCompare(right.symbol, 'en'));
}
