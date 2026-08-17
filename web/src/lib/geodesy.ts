export interface Llh { lat: number; lon: number; h: number; }

const A = 6378137.0; // WGS84 semi-major
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const D2R = Math.PI / 180;

// Local tangent-plane ENU (meters) of a point relative to a reference LLH.
export function llhToEnu(lat: number, lon: number, _h: number, ref: Llh): { e: number; n: number; u: number } {
  const rlat = ref.lat * D2R;
  const sinLat = Math.sin(rlat);
  const rN = A / Math.sqrt(1 - E2 * sinLat * sinLat); // prime vertical radius
  const rM = (A * (1 - E2)) / Math.pow(1 - E2 * sinLat * sinLat, 1.5); // meridian radius
  const dLat = (lat - ref.lat) * D2R;
  const dLon = (lon - ref.lon) * D2R;
  const n = dLat * rM;
  const e = dLon * (rN * Math.cos(rlat));
  return { e, n, u: 0 };
}

export function meanLatLon(pts: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  if (pts.length === 0) return { lat: 0, lon: 0 };
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  return { lat, lon };
}

// Error-ellipse offsets (north, east) in meters from a 2x2 covariance built from
// standard deviations sdn, sde and the cross term sdne (RTKLIB convention: signed
// sqrt of the covariance, so cov_ne = sign * sdne^2).
export function covEllipse(sdn: number, sde: number, sdne: number, sigmaScale = 1, points = 48): Array<[number, number]> {
  const cnn = sdn * sdn;
  const cee = sde * sde;
  const cne = Math.sign(sdne) * sdne * sdne;
  // eigen-decomposition of [[cnn, cne],[cne, cee]]
  const tr = cnn + cee;
  const det = cnn * cee - cne * cne;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  const a = sigmaScale * Math.sqrt(Math.max(0, l1));
  const b = sigmaScale * Math.sqrt(Math.max(0, l2));
  // orientation: angle of major eigenvector (north-east plane)
  const theta = 0.5 * Math.atan2(2 * cne, cnn - cee);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < points; i++) {
    const t = (2 * Math.PI * i) / points;
    const x = a * Math.cos(t); // along major axis
    const y = b * Math.sin(t); // along minor axis
    const dn = x * cos - y * sin;
    const de = x * sin + y * cos;
    ring.push([dn, de]);
  }
  return ring;
}
