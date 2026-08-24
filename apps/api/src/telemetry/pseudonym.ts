import { createHmac } from 'node:crypto';

/**
 * Keyed pseudonyms, versioned.
 *
 * A bare SHA-256 of an email or an IP is not a pseudonym — the input space is small enough
 * to enumerate, so anyone with the table recovers the original. An HMAC with a secret key
 * makes that infeasible while keeping the value stable enough to correlate on, which is the
 * whole point: we need to know that two attempts came from the same place without knowing
 * where that is.
 *
 * The version prefix exists because rotating the key would otherwise silently break every
 * longitudinal feature. On rotation, both versions are written for one retention period so
 * correlation spans the boundary, then the old one is dropped rather than archived.
 */
export interface PseudonymConfig {
  key: string;
  version: number;
}

export function pseudonymise(value: string, config: PseudonymConfig): string {
  const normalised = value.trim().toLowerCase();
  const digest = createHmac('sha256', config.key).update(normalised).digest('hex');
  return `v${config.version}:${digest}`;
}

/**
 * IPv4 is truncated to /24 and IPv6 to /48 *before* hashing.
 *
 * We want to know that many attempts share a network, not which household made them.
 * Truncating first means the precise address is never hashed at all, so it cannot be
 * recovered even in principle.
 */
export function truncateIp(ip: string): string {
  const address = ip.trim();

  if (address.includes(':')) {
    const groups = address.split(':').filter((part) => part !== '');
    return `${groups.slice(0, 3).join(':')}::/48`;
  }

  const octets = address.split('.');
  if (octets.length !== 4) return 'unknown';
  return `${octets.slice(0, 3).join('.')}.0/24`;
}

export function pseudonymiseIp(ip: string, config: PseudonymConfig): string {
  return pseudonymise(truncateIp(ip), config);
}

/**
 * Resolves the client address, trusting forwarding headers only when the request came
 * through a proxy we configured. A user-supplied `x-forwarded-for` is otherwise just a
 * string an attacker controls, and treating it as identity would let anyone forge the
 * correlation key.
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  forwardedFor: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor !== undefined && forwardedFor !== '') {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  return socketAddress ?? 'unknown';
}
