/**
 * Estimate of (server clock - local clock) from one more message
 * serverNow - receivedAt is the true offset minus the message's travel time, so the largest sample is the most accurate.
 */
export function updateOffset(current, serverNow, receivedAt) {
    const sample = serverNow - receivedAt;
    return current === null ? sample : Math.max(current, sample);
}
