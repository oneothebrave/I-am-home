export function formatClockTime(value: string | number | Date = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatEventTime(value: string, now = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  const day = date.toDateString() === new Date(now).toDateString()
    ? '今天' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${day} ${formatClockTime(date)}`;
}
