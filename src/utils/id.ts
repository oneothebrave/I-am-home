let sequence = 0;
const session = Math.random().toString(36).slice(2);

// Session entropy plus a counter avoids same-millisecond UI collisions.
export function createId(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${session}-${sequence.toString(36)}`;
}
