import { memo, useEffect, useState } from 'react';
import { ExternalLink, X, RefreshCw } from 'lucide-react';
import type { PositionReviewCredentialInput, PositionReviewVenues, ReviewVenue } from './position-review-types';
import {
  AFFILIATE_DISCLOSURE,
  fetchWorkspaceSettings,
  type InviteSettings,
} from '@/api/workspace-settings-api';

interface PositionReviewCredentialsModalProps {
  isOpen: boolean;
  venues: PositionReviewVenues;
  savingVenue: ReviewVenue | null;
  auditingCache: boolean;
  onClose: () => void;
  onSaveCredentials: (
    venue: ReviewVenue,
    creds: PositionReviewCredentialInput
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
    const [cfdApiKey, setCfdApiKey] = useState('');
    const [cfdSecret, setCfdSecret] = useState('');
    const [invites, setInvites] = useState<InviteSettings | null>(null);

    useEffect(() => {
      if (!isOpen) return;
      let active = true;
      void fetchWorkspaceSettings()
        .then((settings) => {
          if (active) setInvites(settings.invites);
        })
        .catch(() => {
          if (active) setInvites(null);
        });
      return () => {
        active = false;
      };
    }, [isOpen]);

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

    const handleSaveCfd = async () => {
      try {
        await onSaveCredentials('gate-cfd', { apiKey: cfdApiKey.trim(), secret: cfdSecret.trim() });
        setCfdApiKey('');
        setCfdSecret('');
      } catch {
        // The workspace reports the failure through the global toast.
      }
    };

    const handleReuseGateForCfd = async () => {
      try {
        await onSaveCredentials('gate-cfd', { reuseGateCredentials: true });
      } catch {
        // The workspace reports the failure through the global toast.
      }
    };

    return (
      <div className="posrev-credentials">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0 }}>
            只需只读权限。Bitget、Gate 永续与 Gate CFD 可独立连接，同步后仓位汇聚到同一列表。密钥加密保存在本机，不会回传。
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

        <div className="posrev-affiliate">
          <p>{AFFILIATE_DISCLOSURE}</p>
        </div>

        <div className="posrev-credential-block">
          <strong>Bitget UTA{venues.bitget ? ' · 已配置' : ''}</strong>
          {invites?.bitgetConfigured && invites.bitget ? (
            <a
              className="posrev-invite-cta"
              href={invites.bitget}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={12} />
              通过邀请链接注册 Bitget
            </a>
          ) : (
            <p className="posrev-invite-empty">
              Bitget 邀请链接未配置。在右上角设置中填写，或复制{' '}
              <code>config.local.example.json</code> 为 <code>config.local.json</code>。
            </p>
          )}
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
          {invites?.gateConfigured && invites.gate ? (
            <a
              className="posrev-invite-cta"
              href={invites.gate}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={12} />
              通过邀请链接注册 Gate
            </a>
          ) : (
            <p className="posrev-invite-empty">
              Gate 邀请链接未配置。在右上角设置中填写，或复制{' '}
              <code>config.local.example.json</code> 为 <code>config.local.json</code>。
            </p>
          )}
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

        <div className="posrev-credential-venue-header">
          <strong>Gate CFD / TradFi{venues['gate-cfd'] ? ' · 已配置' : ''}</strong>
        </div>
        <p>
          在 Gate 主账户开通 CFD，并填写具有 CFD / TradFi 读取权限的 API Key 与 Secret。
          可使用已保存的 Gate 永续密钥连接，也可填写另一组密钥。连接后点击「同步」，获取最近一个月历史仓位与当前持仓；
          已保存历史持续保留。盈亏和权益按 USD 展示，数量单位为手。
        </p>
        {venues.gate && !venues['gate-cfd'] && (
          <button type="button" onClick={handleReuseGateForCfd} disabled={savingVenue !== null}>
            {savingVenue === 'gate-cfd' ? '连接中' : '使用已保存的 Gate 密钥连接 CFD'}
          </button>
        )}
        <div className="posrev-credential-fields">
          <input value={cfdApiKey} onChange={(e) => setCfdApiKey(e.target.value)}
            placeholder="CFD API Key" type="password" autoComplete="new-password" spellCheck={false} />
          <input value={cfdSecret} onChange={(e) => setCfdSecret(e.target.value)}
            placeholder="CFD Secret" type="password" autoComplete="new-password" spellCheck={false} />
          <button type="button" onClick={handleSaveCfd}
            disabled={savingVenue !== null || !cfdApiKey.trim() || !cfdSecret.trim()}>
            {savingVenue === 'gate-cfd' ? '保存中' : '保存 Gate CFD 密钥'}
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
