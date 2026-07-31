export function fixedClock(isoTimestamp = '2026-07-31T12:00:00.000Z'): () => Date {
  const timestamp = Date.parse(isoTimestamp);

  if (Number.isNaN(timestamp)) {
    throw new Error('fixedClock requires a valid ISO-8601 timestamp');
  }

  return () => new Date(timestamp);
}
