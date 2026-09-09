import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView,
  SeriesAttachedParameter, UTCTimestamp,
} from 'lightweight-charts';

export interface TradePricePoint {
  time: UTCTimestamp;
  price: number;
  color: string;
  selected: boolean;
}

/** System annotations rendered on the candle price scale, never saved as drawings. */
export class TradePricePrimitive implements ISeriesPrimitive {
  private attachment: SeriesAttachedParameter | null = null;
  private points: TradePricePoint[] = [];
  private readonly renderer: ISeriesPrimitivePaneRenderer = {
    draw: (target) => {
      const attachment = this.attachment;
      if (!attachment) return;
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        context.save();
        // Draw the selected points last so they remain visible when trades overlap.
        for (const selected of [false, true]) {
          for (const point of this.points) {
            if (point.selected !== selected) continue;
            const x = attachment.chart.timeScale().timeToCoordinate(point.time);
            const y = attachment.series.priceToCoordinate(point.price);
            if (x == null || y == null || x < 0 || x > mediaSize.width || y < 0 || y > mediaSize.height) continue;
            context.beginPath();
            context.arc(x, y, selected ? 6 : 3, 0, Math.PI * 2);
            context.fillStyle = point.color;
            context.fill();
            context.strokeStyle = '#ffffff';
            context.lineWidth = selected ? 2 : 1;
            context.stroke();
          }
        }
        context.restore();
      });
    },
  };
  private readonly views: ISeriesPrimitivePaneView[] = [{
    zOrder: () => 'top',
    renderer: () => this.renderer,
  }];

  attached(attachment: SeriesAttachedParameter) {
    this.attachment = attachment;
    attachment.requestUpdate();
  }

  detached() { this.attachment = null; }

  paneViews() { return this.views; }

  setPoints(points: TradePricePoint[]) {
    this.points = points;
    this.attachment?.requestUpdate();
  }
}
