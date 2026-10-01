import { useRef, useState, type RefObject } from 'react';
import { captureChartPng, type ChartCaptureLabel } from './capture-chart-png';
import { reviewCardHtml, type ReviewCard } from './review-card';
import { toast } from '@/ui/feedback/toast';

export function useChartExport(root: RefObject<HTMLDivElement>, theme: 'dark' | 'light', label: ChartCaptureLabel, card: ReviewCard) {
  const [copyingChart, setCopyingChart] = useState(false);
  const [exportingCard, setExportingCard] = useState(false);
  const busy = useRef(false);
  const copyChart = async () => {
    if (!root.current || busy.current) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      toast.error('当前浏览器不支持复制图片到剪贴板'); return;
    }
    busy.current = true;
    setCopyingChart(true);
    try {
      const png = await captureChartPng(root.current, theme, label);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast.success('K 线图已复制到剪贴板');
    } catch (cause) {
      toast.error(`复制图表失败: ${cause instanceof Error ? cause.message : '剪贴板操作失败'}`);
    } finally { busy.current = false; setCopyingChart(false); }
  };
  const exportCard = async () => {
    if (!root.current || busy.current) return;
    busy.current = true;
    setExportingCard(true);
    try {
      const png = await captureChartPng(root.current, theme, label);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(png);
      });
      const url = URL.createObjectURL(new Blob([reviewCardHtml(card, dataUrl)], { type: 'text/html;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `review-${label.symbol}-${Date.now()}.html`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('复盘卡片已导出，包含当前图表和已保存笔记');
    } catch (cause) {
      toast.error(`导出失败: ${cause instanceof Error ? cause.message : '图片生成失败'}`);
    } finally { busy.current = false; setExportingCard(false); }
  };
  return { copyingChart, exportingCard, copyChart, exportCard };
}
