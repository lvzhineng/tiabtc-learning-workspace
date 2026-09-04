import { useEffect, useState } from 'react';
import { Settings, X } from 'lucide-react';
import {
  AFFILIATE_DISCLOSURE,
  fetchWorkspaceSettings,
  saveInviteUrls,
  type InviteSettings,
} from '@/api/workspace-settings-api';
import { toast } from '@/ui/feedback/toast';
import '@/styles/shortcut-modal.css';
import '@/styles/settings-modal.css';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EMPTY_INVITES: InviteSettings = {
  gate: '',
  bitget: '',
  gateConfigured: false,
  bitgetConfigured: false,
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [gate, setGate] = useState('');
  const [bitget, setBitget] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    void fetchWorkspaceSettings()
      .then((settings) => {
        if (!active) return;
        setGate(settings.invites.gate || '');
        setBitget(settings.invites.bitget || '');
      })
      .catch((cause) => {
        if (!active) return;
        setGate(EMPTY_INVITES.gate);
        setBitget(EMPTY_INVITES.bitget);
        const errMsg = cause instanceof Error ? cause.message : '读取设置失败';
        toast.error(errMsg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const settings = await saveInviteUrls({
        gate: gate.trim(),
        bitget: bitget.trim(),
      });
      setGate(settings.invites.gate || '');
      setBitget(settings.invites.bitget || '');
      toast.success('邀请链接已保存');
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : '保存邀请链接失败';
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="shortcut-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="shortcut-modal-container settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="shortcut-modal-header">
          <div className="shortcut-modal-title">
            <Settings size={18} className="shortcut-modal-icon" />
            <h3>设置</h3>
          </div>
          <button
            type="button"
            className="shortcut-modal-close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </header>

        <div className="shortcut-modal-body settings-modal-body">
          <section className="settings-section">
            <h4>交易所邀请链接</h4>
            <p className="settings-disclosure">{AFFILIATE_DISCLOSURE}</p>
            <p className="settings-hint">
              默认使用作者的 Gate / Bitget 邀请深度链接。Fork 可复制{' '}
              <code>config.local.example.json</code> 为 <code>config.local.json</code>
              后改成自己的链接，或设置环境变量 <code>TIA_GATE_INVITE_URL</code> /{' '}
              <code>TIA_BITGET_INVITE_URL</code>。
            </p>

            <label className="settings-field">
              <span>Gate 邀请 / 深度链接</span>
              <input
                className="ui-input"
                value={gate}
                onChange={(e) => setGate(e.target.value)}
                placeholder="https:// 或留空"
                spellCheck={false}
                disabled={loading || saving}
              />
            </label>
            <label className="settings-field">
              <span>Bitget 邀请 / 深度链接</span>
              <input
                className="ui-input"
                value={bitget}
                onChange={(e) => setBitget(e.target.value)}
                placeholder="https:// 或留空"
                spellCheck={false}
                disabled={loading || saving}
              />
            </label>
            {!gate.trim() && !bitget.trim() ? (
              <p className="settings-hint">
                当前未配置有效邀请链接。连接交易所时仍会显示说明，但不会出现注册按钮。
              </p>
            ) : null}
          </section>
        </div>

        <footer className="shortcut-modal-footer">
          <span>邀请链接只保存在本机，不会写入交易逻辑。</span>
          <button
            type="button"
            className="shortcut-btn-close"
            onClick={() => void handleSave()}
            disabled={loading || saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
