import { memo, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import type { PositionReviewVenues, ReviewVenue } from './position-review-types';

interface PositionReviewCredentialsModalProps {
  isOpen: boolean;
  venues: PositionReviewVenues;
  savingVenue: ReviewVenue | null;
  auditingCache: boolean;
  onClose: () => void;
  onSaveCredentials: (
    venue: ReviewVenue,
    creds: { apiKey: string; secret: string; passphrase?: string }
  ) => Promise<void>;
  onAuditCache: () => Promise<void>;
}

export const PositionReviewCredentialsModal = memo(
  function PositionReviewCredentialsModal({
    isOpen,
    venues,
    savingVenue,
    auditingCache,
    onClose,
    onSaveCredentials,
    onAuditCache,
  }: PositionReviewCredentialsModalProps) {
    const [bitgetApiKey, setBitgetApiKey] = useState('');
    const [bitgetSecret, setBitgetSecret] = useState('');
    const [bitgetPassphrase, setBitgetPassphrase] = useState('');
    const [gateApiKey, setGateApiKey] = useState('');
    const [gateSecret, setGateSecret] = useState('');

    if (!isOpen) return null;

    const handleSaveBitget = async () => {
      await onSaveCredentials('bitget', {
        apiKey: bitgetApiKey.trim(),
        secret: bitgetSecret.trim(),
        passphrase: bitgetPassphrase.trim(),
      });
      setBitgetApiKey('');
      setBitgetSecret('');
      setBitgetPassphrase('');
    };

    const handleSaveGate = async () => {
      await onSaveCredentials('gate', {
        apiKey: gateApiKey.trim(),
        secret: gateSecret.trim(),
      });
      setGateApiKey('');
      setGateSecret('');
    };

    return (
      <div className="posrev-credentials">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0 }}>
            只需只读权限。Bitget 与 Gate 可同时保存，同步后仓位汇聚到同一列表。密钥加密保存在本机，不会回传。
          </p>
          <button
            type="button"
            className="shortcut-modal-close"
            onClick={onClose}
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <div className="posrev-credential-block">
          <strong>Bitget UTA{venues.bitget ? ' · 已配置' : ''}</strong>
          <input
            value={bitgetApiKey}
            onChange={(e) => setBitgetApiKey(e.target.value)}
            placeholder="API Key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
          />
          <input
            value={bitgetSecret}
            onChange={(e) => setBitgetSecret(e.target.value)}
            placeholder="Secret"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
          />
          <input
            value={bitgetPassphrase}
            onChange={(e) => setBitgetPassphrase(e.target.value)}
            placeholder="Passphrase"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleSaveBitget}
            disabled={
              savingVenue !== null ||
              !bitgetApiKey.trim() ||
              !bitgetSecret.trim() ||
              !bitgetPassphrase.trim()
            }
          >
            {savingVenue === 'bitget' ? '保存中' : '保存 Bitget 密钥'}
          </button>
        </div>

        <div className="posrev-credential-block">
          <strong>Gate USDT 永续{venues.gate ? ' · 已配置' : ''}</strong>
          <input
            value={gateApiKey}
            onChange={(e) => setGateApiKey(e.target.value)}
            placeholder="API Key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
          />
          <input
            value={gateSecret}
            onChange={(e) => setGateSecret(e.target.value)}
            placeholder="Secret (Secret Key)"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleSaveGate}
            disabled={
              savingVenue !== null ||
              !gateApiKey.trim() ||
              !gateSecret.trim()
            }
          >
            {savingVenue === 'gate' ? '保存中' : '保存 Gate 密钥'}
          </button>
        </div>

        <div className="posrev-credential-audit">
          <button
            type="button"
            className="posrev-audit-btn"
            onClick={onAuditCache}
            disabled={auditingCache}
          >
            {auditingCache ? <RefreshCw size={13} className="spin" /> : null}
            {auditingCache ? '正在审计...' : '只读审计交易所回退缓存'}
          </button>
        </div>
      </div>
    );
  }
);
