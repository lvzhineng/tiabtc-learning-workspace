async function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(rect.width));
  clone.setAttribute('height', String(rect.height));
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type ChartCaptureLabel = {
  symbol: string;
  timeframe: string;
  time?: string;
  source?: string;
};

function formatCaptureLabel(label: ChartCaptureLabel): string {
  return [label.symbol, label.timeframe, label.source]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
}

function formatLocalCaptureTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(absoluteOffset / 60))}:${pad(
    absoluteOffset % 60
  )}`;
  return `本机时间 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )} UTC${offset}`;
}

function drawCaptureLabel(
  context: CanvasRenderingContext2D,
  label: ChartCaptureLabel,
  themeMode: 'dark' | 'light',
  width: number
) {
  const text = formatCaptureLabel(label);
  const localTime = formatLocalCaptureTime(new Date());
  const fontSize = Math.max(12, Math.min(15, Math.round(width / 72)));
  const top = 10;
  context.save();
  context.textBaseline = 'top';
  context.shadowColor =
    themeMode === 'dark' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(255, 255, 255, 0.85)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 1;
  context.fillStyle =
    themeMode === 'dark' ? 'rgba(178, 181, 190, 0.95)' : 'rgba(19, 23, 34, 0.78)';
  context.font = `600 ${fontSize}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
  const labelWidth = context.measureText(text).width;
  context.font = `500 ${fontSize}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
  const timeWidth = context.measureText(localTime).width;
  const stackTime = Boolean(text) && labelWidth + timeWidth + 48 > width;

  if (text) {
    context.font = `600 ${fontSize}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    context.textAlign = 'left';
    const maxLabelWidth = stackTime
      ? Math.max(80, width - 24)
      : Math.max(80, width - timeWidth - 36);
    context.fillText(text, 12, top, maxLabelWidth);
  }

  context.font = `500 ${fontSize}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
  context.textAlign = 'right';
  context.fillText(
    localTime,
    width - 12,
    stackTime ? top + fontSize + 4 : top,
    Math.max(120, width - 24)
  );
  if (label.time) {
    context.font = `600 ${fontSize}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    context.textAlign = 'left';
    context.fillText(
      label.time,
      12,
      top + (stackTime ? 2 : 1) * (fontSize + 4),
      Math.max(80, width - 24)
    );
  }
  context.restore();
}

export async function captureChartPng(
  root: HTMLElement,
  themeMode: 'dark' | 'light',
  label?: ChartCaptureLabel
): Promise<Blob> {
  const chartArea = root.querySelector<HTMLElement>('.chart-canvas-stack');
  if (!chartArea) throw new Error('图表尚未就绪');
  const areaRect = chartArea.getBoundingClientRect();
  if (areaRect.width < 1 || areaRect.height < 1) {
    throw new Error('图表尺寸无效');
  }

  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const output = document.createElement('canvas');
  output.width = Math.round(areaRect.width * scale);
  output.height = Math.round(areaRect.height * scale);
  const context = output.getContext('2d');
  if (!context) throw new Error('浏览器无法创建截图画布');
  context.scale(scale, scale);
  context.fillStyle = themeMode === 'dark' ? '#131722' : '#ffffff';
  context.fillRect(0, 0, areaRect.width, areaRect.height);

  const layers = Array.from(
    chartArea.querySelectorAll<HTMLCanvasElement | SVGSVGElement>('canvas, svg')
  );
  for (const layer of layers) {
    const rect = layer.getBoundingClientRect();
    if (
      rect.width < 1 ||
      rect.height < 1 ||
      rect.right <= areaRect.left ||
      rect.left >= areaRect.right ||
      rect.bottom <= areaRect.top ||
      rect.top >= areaRect.bottom ||
      getComputedStyle(layer).visibility === 'hidden'
    ) {
      continue;
    }
    const x = rect.left - areaRect.left;
    const y = rect.top - areaRect.top;
    if (layer instanceof HTMLCanvasElement) {
      context.drawImage(layer, x, y, rect.width, rect.height);
    } else {
      const image = await svgToImage(layer);
      context.drawImage(image, x, y, rect.width, rect.height);
    }
  }

  if (label) {
    drawCaptureLabel(context, label, themeMode, areaRect.width);
  }

  return new Promise<Blob>((resolve, reject) => {
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('生成 PNG 失败'))),
      'image/png'
    );
  });
}
