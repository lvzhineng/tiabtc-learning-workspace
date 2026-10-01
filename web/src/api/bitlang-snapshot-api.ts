import type { BitlangTradeSnapshot } from '@/features/bitlang/bitlang-types';

let snapshotRequest: Promise<BitlangTradeSnapshot> | null = null;

export function loadBitlangSnapshot(): Promise<BitlangTradeSnapshot> {
  if (!snapshotRequest) {
    snapshotRequest = fetch('/bitlang-trades.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<BitlangTradeSnapshot>;
      })
      .catch((error) => {
        snapshotRequest = null;
        throw error;
      });
  }
  return snapshotRequest;
}
