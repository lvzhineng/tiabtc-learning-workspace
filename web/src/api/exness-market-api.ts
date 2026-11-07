import { requestJson } from './http';

export interface ExnessMarketConnectionState {
  configured: boolean;
  currency: string | null;
  marketKey: string | null;
}

export interface SaveExnessMarketConnectionInput {
  accountId: string;
  apiKey: string;
  secret: string;
  gatewayHost: string;
}

const EXNESS_CONNECTION_PATH = '/api/position-review/exness-connection';

export function fetchExnessMarketConnection(): Promise<ExnessMarketConnectionState> {
  return requestJson<ExnessMarketConnectionState>(EXNESS_CONNECTION_PATH);
}

export function saveExnessMarketConnection(
  input: SaveExnessMarketConnectionInput
): Promise<ExnessMarketConnectionState> {
  return requestJson<ExnessMarketConnectionState>(EXNESS_CONNECTION_PATH, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
