import type { GuardianSchedule } from './types';

const minuteOfDay = (clock: string) => {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
};

export function isWithinGuardianWindow(schedule: GuardianSchedule, date = new Date()) {
  const current = date.getHours() * 60 + date.getMinutes();
  return (
    current >= minuteOfDay(schedule.startTime) &&
    current < minuteOfDay(schedule.expectedReturnTime)
  );
}
