export interface DrawingStylePreferences {
  color: string;
  lineWidth: number;
  lineStyle?: 'solid' | 'dashed';
}

const STORAGE_KEY = 'tiabtc_drawing_tool_styles_v1';

const TOOL_DEFAULTS: Record<string, Partial<DrawingStylePreferences>> = {
  'arrow-mark-up': { color: '#089981', lineWidth: 2 },
  'arrow-mark-down': { color: '#f23645', lineWidth: 2 },
  FibRetracement: { color: '#2962ff', lineWidth: 1 },
  'half-retracement': { color: '#facc15', lineWidth: 1 },
};

const BASE_DEFAULT: DrawingStylePreferences = {
  color: '#2962ff',
  lineWidth: 2,
  lineStyle: 'solid',
};

export function getSavedDrawingStyle(toolType: string): DrawingStylePreferences {
  const toolDefault = TOOL_DEFAULTS[toolType] || {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        color: toolDefault.color ?? BASE_DEFAULT.color,
        lineWidth: toolDefault.lineWidth ?? BASE_DEFAULT.lineWidth,
        lineStyle: toolDefault.lineStyle ?? BASE_DEFAULT.lineStyle,
      };
    }
    const parsed = JSON.parse(raw);
    const saved = parsed[toolType] || parsed._globalLastUsed || {};
    return {
      color: typeof saved.color === 'string' ? saved.color : (toolDefault.color ?? BASE_DEFAULT.color),
      lineWidth: typeof saved.lineWidth === 'number' ? saved.lineWidth : (toolDefault.lineWidth ?? BASE_DEFAULT.lineWidth),
      lineStyle: saved.lineStyle === 'dashed' ? 'dashed' : (toolDefault.lineStyle ?? BASE_DEFAULT.lineStyle),
    };
  } catch {
    return {
      color: toolDefault.color ?? BASE_DEFAULT.color,
      lineWidth: toolDefault.lineWidth ?? BASE_DEFAULT.lineWidth,
      lineStyle: toolDefault.lineStyle ?? BASE_DEFAULT.lineStyle,
    };
  }
}

export function saveDrawingStyle(
  toolType: string,
  style: Partial<DrawingStylePreferences>
): void {
  if (!toolType) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const existing = parsed[toolType] || parsed._globalLastUsed || BASE_DEFAULT;
    const updated: DrawingStylePreferences = {
      color: style.color ?? existing.color ?? BASE_DEFAULT.color,
      lineWidth: style.lineWidth ?? existing.lineWidth ?? BASE_DEFAULT.lineWidth,
      lineStyle: style.lineStyle ?? existing.lineStyle ?? BASE_DEFAULT.lineStyle,
    };
    parsed[toolType] = updated;
    parsed._globalLastUsed = updated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}
