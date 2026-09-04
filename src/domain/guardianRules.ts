import type { GuardianEvent, GuardianStatus } from './types';

export function getStatusTone(status: GuardianStatus) {
  switch (status) {
    case 'safe':
      return {
        label: '安全',
        background: '#E8F5EF',
        foreground: '#17684A',
        accent: '#2E8B68',
      };
    case 'attention':
      return {
        label: '关注',
        background: '#FFF4D8',
        foreground: '#7A4B00',
        accent: '#D68A00',
      };
    case 'emergency':
      return {
        label: '异常',
        background: '#FFE8E4',
        foreground: '#8B1D12',
        accent: '#D94B3D',
      };
  }
}

export function summarizeRiskReason(events: GuardianEvent[]) {
  const latestEvent = events.at(-1);

  if (!latestEvent) {
    return '暂时没有发现需要关注的风险信号。';
  }

  if (['SOS_SENT', 'RISK_ESCALATED', 'FAMILY_NOTIFIED', 'ESCALATION_FINISHED'].includes(latestEvent.type)) {
    return latestEvent.description;
  }

  if (latestEvent.type === 'SAFETY_CHECK_REQUESTED') {
    return latestEvent.description;
  }

  if (['RETURN_HOME', 'MOTION_DETECTED', 'USER_CONFIRMED_SAFE'].includes(latestEvent.type)) {
    return `${latestEvent.title}，当前状态已经续上安全信号。`;
  }

  const latestRiskEvent = [...events].reverse().find(event =>
    ['LONG_STAY', 'LOW_BATTERY', 'LOCATION_LOST', 'NO_MOTION_FOR_LONG_TIME'].includes(
      event.type,
    ),
  );

  if (!latestRiskEvent) {
    return '今天的轨迹符合常规模式。';
  }

  return latestRiskEvent.description;
}
