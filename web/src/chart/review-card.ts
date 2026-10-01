export type ReviewCard = { title: string; details: string[]; note: string; tags: string[]; sourceNote?: string };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

/** Self-contained offline card. Every user/source string is escaped. */
export function reviewCardHtml(card: ReviewCard, pngDataUrl: string): string {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(pngDataUrl)) throw new Error('无效的图表图片');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(card.title)}</title>
<style>body{max-width:1200px;margin:32px auto;padding:0 20px;font:16px/1.6 system-ui;color:#18202d;background:#f5f7fa}img{width:100%;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:white;padding:20px;border-radius:8px}.tags{color:#475569}</style>
<h1>${escapeHtml(card.title)}</h1><p>${card.details.map(escapeHtml).join(' · ')}</p><img alt="复盘图表" src="${pngDataUrl}"><p class="tags">标签：${card.tags.map(escapeHtml).join('、') || '无'}</p>
<h2>本机复盘笔记</h2><pre>${escapeHtml(card.note || '暂无已保存笔记')}</pre>${card.sourceNote ? `<h2>交割单原始备注</h2><pre>${escapeHtml(card.sourceNote)}</pre>` : ''}</html>`;
}
