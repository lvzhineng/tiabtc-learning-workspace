import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import '@/styles/shortcut-modal.css';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: '全局通用',
    items: [
      { key: '?', desc: '打开 / 关闭本快捷键速查面板' },
      { key: '[', desc: '沉浸复盘模式（折叠 / 展开左侧面板）' },
      { key: 'Esc', desc: '关闭弹窗 / 取消当前操作' },
    ],
  },
  {
    title: '行情复盘与自由推演',
    items: [
      { key: '→', desc: '前进下一根 K 线（未播放时以当前位置开启回放）' },
      { key: '←', desc: '后退上一根 K 线' },
      { key: 'Space', desc: '播放 / 暂停自由回放' },
      { key: '双击 K 线', desc: '定位至该柱对应时间点' },
    ],
  },
  {
    title: '仓位复盘与交割单列表',
    items: [
      { key: '↑ / ↓ 或 j / k', desc: '上下切换选中的仓位 / 交易记录' },
      { key: '1 ~ 7', desc: '快速切换 K 线周期（1m 至 1w）' },
    ],
  },
  {
    title: '图表交互手势',
    items: [
      { key: '鼠标滚轮', desc: '缩放时间轴视口范围' },
      { key: '拖拽图表背景', desc: '水平平移时间轴' },
      { key: '拖拽右侧价格轴', desc: '垂直拉伸 / 压缩价格坐标' },
    ],
  },
];

export function ShortcutHelpModal({ isOpen, onClose }: ShortcutHelpModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="shortcut-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={modalRef}
        className="shortcut-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcut-modal-header">
          <div className="shortcut-modal-title">
            <Keyboard size={18} className="shortcut-modal-icon" />
            <h3>快捷键速查指南</h3>
          </div>
          <button
            type="button"
            className="shortcut-modal-close"
            onClick={onClose}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div className="shortcut-modal-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcut-group">
              <h4 className="shortcut-group-title">{group.title}</h4>
              <div className="shortcut-group-list">
                {group.items.map((item) => (
                  <div key={item.key} className="shortcut-row">
                    <span className="shortcut-desc">{item.desc}</span>
                    <kbd className="shortcut-kbd">{item.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <footer className="shortcut-modal-footer">
          <span>提示：焦点位于输入框时不会触发快捷键</span>
          <button type="button" className="shortcut-btn-close" onClick={onClose}>
            我知道了
          </button>
        </footer>
      </div>
    </div>
  );
}
