import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import type { Candlestick } from '@/domain/candle';
import { timestampMsToUtcTimestamp } from './chart-time';
import { formatPrice } from './chart-price';

/** Automatic reference rays; no drawing objects or future time-scale points. */
export class PreviousDayRangePrimitive implements ISeriesPrimitive {
  private attachment: SeriesAttachedParameter | null = null;
  private levels: { timestampMs: number; price: number; title: string; color: string }[] = [];
  private readonly renderer: ISeriesPrimitivePaneRenderer = {
    draw: (target) => {
      const attachment = this.attachment;
      if (!attachment) return;
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        context.save();
        for (const level of this.levels) {
          const x = attachment.chart.timeScale().timeToCoordinate(timestampMsToUtcTimestamp(level.timestampMs));
          const y = attachment.series.priceToCoordinate(level.price);
          if (x === null || y === null || x > mediaSize.width || y < 0 || y > mediaSize.height) continue;
          context.strokeStyle = level.color;
          context.lineWidth = 1;
          context.setLineDash([6, 4]);
          context.beginPath();
          context.moveTo(Math.max(0, x), y);
          context.lineTo(mediaSize.width, y);
          context.stroke();
          context.fillStyle = level.color;
          context.font = '11px Arial, sans-serif';
          context.textAlign = 'right';
          context.fillText(`${level.title} ${formatPrice(level.price)}`, mediaSize.width - 8,
            Math.max(12, y - 5));
        }
        context.restore();
      });
    },
  };
  private readonly views: ISeriesPrimitivePaneView[] = [{ zOrder: () => 'top', renderer: () => this.renderer }];
  attached(attachment: SeriesAttachedParameter) { this.attachment = attachment; attachment.requestUpdate(); }
  detached() { this.attachment = null; }
  paneViews() { return this.views; }

  setCandles(candles: Candlestick[]) {
    this.levels = [];
    if (candles.length) {
      let high = candles[0];
      let low = candles[0];
      for (const bar of candles) {
        if (bar.high > high.high) high = bar;
        if (bar.low < low.low) low = bar;
      }
      this.levels = [
        { timestampMs: high.timestampMs, price: high.high, title: '前日高', color: '#e05260' },
        { timestampMs: low.timestampMs, price: low.low, title: '前日低', color: '#269d8c' },
      ];
    }
    this.attachment?.requestUpdate();
  }
}
