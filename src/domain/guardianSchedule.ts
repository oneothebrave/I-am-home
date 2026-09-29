import type { GuardianSchedule } from './types';
import { isClockTime } from './validation';

const minuteOfDay = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
};

export function isWithinGuardianWindow(schedule: GuardianSchedule, date = new Date()) {
  if (!Number.isFinite(date.getTime()) || !isClockTime(schedule.startTime) ||
      !isClockTime(schedule.expectedReturnTime) || schedule.startTime >= schedule.expectedReturnTime)
    return false;
  const current = date.getHours() * 60 + date.getMinutes();
  return (
    current >= minuteOfDay(schedule.startTime) &&
    current < minuteOfDay(schedule.expectedReturnTime)
  );
}
