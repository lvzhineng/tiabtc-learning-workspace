import { readLocalUiState, storedBoolean, writeLocalUiState } from '@/ui/persistence/local-ui-state';
import type { EmaVisibility } from './ema';

export type IndicatorScope = 'perpetual' | 'cfd' | 'position' | 'bitlang';
export type EmaPreferences = { visibility: EmaVisibility; collapsed: boolean };
const key = (scope: IndicatorScope) => `tiabtc-chart-indicators-${scope}-v1`;

export function loadEmaPreferences(scope: IndicatorScope): EmaPreferences {
  const saved = readLocalUiState(key(scope));
  const visibility = saved.visibility && typeof saved.visibility === 'object' && !Array.isArray(saved.visibility)
    ? saved.visibility as Record<string, unknown> : {};
  const legacy = scope === 'perpetual' || scope === 'cfd'
    ? readLocalUiState(scope === 'cfd' ? 'tiabtc-cfd-ui-v1' : 'tiabtc-review-ui-v1').showEma20 : undefined;
  return {
    visibility: { 20: storedBoolean(visibility[20], storedBoolean(legacy, true)),
      60: storedBoolean(visibility[60], true), 120: storedBoolean(visibility[120], true) },
    collapsed: storedBoolean(saved.collapsed, false),
  };
}

export function saveEmaPreferences(scope: IndicatorScope, preferences: EmaPreferences): void {
  writeLocalUiState(key(scope), preferences);
}
