import type { GuardianEvent, GuardianStatus } from './types';
import { buildGuardianSnapshot } from './riskEngine';

export function getStatusTone(status: GuardianStatus) {
  const tones = {
    unknown: { label: '待确认', background: '#EEF0F2', foreground: '#454B50', accent: '#758087' },
    safe: { label: '安全', background: '#E8F5EF', foreground: '#17684A', accent: '#2E8B68' },
    attention: { label: '关注', background: '#FFF4D8', foreground: '#7A4B00', accent: '#D68A00' },
    emergency: { label: '异常', background: '#FFE8E4', foreground: '#8B1D12', accent: '#D94B3D' },
  };
  return tones[status];
}

export function summarizeRiskReason(events: GuardianEvent[], now = Date.now()) {
  return buildGuardianSnapshot(events, { now }).riskReason ?? '暂无告警信息。';
}
