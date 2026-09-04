import { requestJson } from './http';
import type { VideoCatalogSource } from './video-api';

export const AFFILIATE_DISCLOSURE =
  '通过此链接注册，作者可能获得交易手续费返佣；你可在设置中自行改邀请码。';

export const TIA_TEMPLATE_URL = 'https://www.youtube.com/@tiabtc';

export type InviteSettings = {
  gate: string;
  bitget: string;
  gateConfigured: boolean;
  bitgetConfigured: boolean;
};

export type WorkspaceSettings = {
  invites: InviteSettings;
  videoSource: VideoCatalogSource;
};

export async function fetchWorkspaceSettings(
  signal?: AbortSignal
): Promise<WorkspaceSettings> {
  return requestJson<WorkspaceSettings>('/api/settings', { signal });
}

export async function saveInviteUrls(payload: {
  gate: string;
  bitget: string;
}): Promise<WorkspaceSettings> {
  return requestJson<WorkspaceSettings>('/api/settings/invites', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
