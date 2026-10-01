export function ReviewQueueButton({ noNote, noTag, onChange }: {
  noNote: boolean; noTag: boolean; onChange: (enabled: boolean) => void;
}) {
  const active = noNote && noTag;
  return <button type="button" className={active ? 'active' : ''} aria-pressed={active}
    title="筛选同时无本机笔记且无标签的记录，保留其它筛选条件"
    onClick={() => onChange(!active)}>待复盘</button>;
}
