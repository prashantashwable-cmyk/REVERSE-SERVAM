/**
 * Possible-duplicate detection for leads (spec §7.4, §37 SE03).
 * Detection never merges anything: it only produces explained candidates for a
 * human, authorized decision. Mirrors public.search_possible_duplicates().
 */

/** pg_trgm-compatible trigram set (lower-cased; non-alphanumerics split words). */
export function trigrams(input: string): Set<string> {
  const out = new Set<string>();
  const words = input.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm similarity(): |A∩B| / |A∪B|, 0 when either side is empty. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Great-circle distance in metres (WGS84 mean radius). */
export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface DuplicateProbe {
  phone?: string | null; // E.164
  alternatePhone?: string | null;
  email?: string | null; // normalized
  projectName?: string | null;
  builderName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DuplicateCandidateRecord extends DuplicateProbe {
  id: string;
}

export type DuplicateReason = 'phone' | 'email' | 'project_name' | 'builder_name' | 'site_proximity';

export interface DuplicateMatch {
  id: string;
  reasons: DuplicateReason[];
  /** strong = identical phone or email; possible = similarity / proximity only. */
  level: 'strong' | 'possible';
  distanceM?: number;
}

export interface DuplicateOptions {
  nameSimilarityThreshold?: number; // default 0.6
  proximityMetres?: number; // default 150
}

export function findPossibleDuplicates(
  probe: DuplicateProbe,
  records: readonly DuplicateCandidateRecord[],
  opts: DuplicateOptions = {},
): DuplicateMatch[] {
  const threshold = opts.nameSimilarityThreshold ?? 0.6;
  const radius = opts.proximityMetres ?? 150;
  const probePhones = [probe.phone, probe.alternatePhone].filter((p): p is string => !!p);
  const out: DuplicateMatch[] = [];
  for (const r of records) {
    const reasons: DuplicateReason[] = [];
    const recPhones = [r.phone, r.alternatePhone].filter((p): p is string => !!p);
    if (probePhones.some((p) => recPhones.includes(p))) reasons.push('phone');
    if (probe.email && r.email && probe.email === r.email) reasons.push('email');
    if (probe.projectName && r.projectName && similarity(probe.projectName, r.projectName) >= threshold) reasons.push('project_name');
    if (probe.builderName && r.builderName && similarity(probe.builderName, r.builderName) >= threshold) reasons.push('builder_name');
    let distanceM: number | undefined;
    if (
      probe.latitude != null && probe.longitude != null && r.latitude != null && r.longitude != null
    ) {
      distanceM = haversineMetres(probe.latitude, probe.longitude, r.latitude, r.longitude);
      if (distanceM <= radius) reasons.push('site_proximity');
    }
    if (reasons.length === 0) continue;
    const level = reasons.includes('phone') || reasons.includes('email') ? 'strong' : 'possible';
    out.push(distanceM === undefined ? { id: r.id, reasons, level } : { id: r.id, reasons, level, distanceM });
  }
  return out.sort((a, b) => (a.level === b.level ? b.reasons.length - a.reasons.length : a.level === 'strong' ? -1 : 1));
}
