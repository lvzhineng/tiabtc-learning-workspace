import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import {
  saveExnessMarketConnection,
  type ExnessMarketConnectionState,
} from '@/api/exness-market-api';
import { toast } from '@/ui/feedback/toast';
import './exness-market-connection.css';

const DEFAULT_GATEWAY_HOST = 'https://api.exness.com';

interface ExnessMarketConnectionPanelProps {
  state: ExnessMarketConnectionState;
  onConnected: (state: ExnessMarketConnectionState) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
}

export function ExnessMarketConnectionPanel({
  state,
  onConnected,
  onClose,
  onSavingChange,
}: ExnessMarketConnectionPanelProps) {
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [gatewayHost, setGatewayHost] = useState(DEFAULT_GATEWAY_HOST);
  const [saving, setSaving] = useState(false);

  const clearCredentials = () => {
    setAccountId('');
    setApiKey('');
    setSecret('');
  };

  const handleClose = () => {
    clearCredentials();
    setGatewayHost(DEFAULT_GATEWAY_HOST);
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const trimmedAccountId = accountId.trim();
    const trimmedApiKey = apiKey.trim();
    const trimmedSecret = secret.trim();
    const trimmedGatewayHost = gatewayHost.trim();
    if (!trimmedAccountId || !trimmedApiKey || !trimmedSecret || !trimmedGatewayHost) {
      toast.error('请填写完整的 Exness 连接信息');
      return;
    }

    try {
      const gatewayUrl = new URL(trimmedGatewayHost);
      if (gatewayUrl.protocol !== 'https:') {
        toast.error('Gateway Host 必须是 HTTPS 地址');
        return;
      }
    } catch {
      toast.error('Gateway Host 地址无效');
      return;
    }

    setSaving(true);
    onSavingChange?.(true);
    let nextState: ExnessMarketConnectionState;
    try {
      nextState = await saveExnessMarketConnection({
        accountId: trimmedAccountId,
        apiKey: trimmedApiKey,
        secret: trimmedSecret,
        gatewayHost: trimmedGatewayHost,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Exness 连接保存失败，请检查配置后重试');
      return;
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
    clearCredentials();
    toast.success('Exness 已连接，可点击同步读取交易记录');
    onConnected(nextState);
  };

  return (
    <section className="exness-connection-panel" aria-labelledby="exness-connection-title">
      <header className="exness-connection-header">
        <div>
          <strong id="exness-connection-title">连接 Exness 交易账户</strong>
          <span className={`exness-connection-status${state.configured ? ' is-connected' : ''}`}>
            {state.configured
              ? `已配置${state.currency ? ` · ${state.currency}` : ''}`
              : '未连接'}
          </span>
        </div>
        <button
          className="exness-connection-close"
          type="button"
          onClick={handleClose}
          title="关闭"
          aria-label="关闭 Exness 连接"
          disabled={saving}
        >
          <X size={14} />
        </button>
      </header>

      <p className="exness-connection-note">
        连接后点击同步，即可读取历史成交与当前持仓，无需导出文件。仅调用只读接口；指数使用 Gate CFD 参考行情。
      </p>

      <form className="exness-connection-form" onSubmit={handleSubmit}>
        <label className="exness-connection-field">
          <span>Account ID</span>
          <input
            type="text"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={saving}
          />
        </label>
        <label className="exness-connection-field">
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            required
            disabled={saving}
          />
        </label>
        <label className="exness-connection-field">
          <span>Ed25519 私钥</span>
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            required
            disabled={saving}
          />
        </label>
        <label className="exness-connection-field">
          <span>Gateway Host</span>
          <input
            type="url"
            value={gatewayHost}
            onChange={(event) => setGatewayHost(event.target.value)}
            autoComplete="url"
            spellCheck={false}
            required
            disabled={saving}
          />
        </label>
        <footer className="exness-connection-actions">
          <button type="button" onClick={handleClose} disabled={saving}>
            取消
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? '保存中…' : state.configured ? '更新连接' : '保存连接'}
          </button>
        </footer>
      </form>
    </section>
  );
}
