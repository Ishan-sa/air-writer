import type { WallPoint } from '../shared/types';

/** Row-major 3x3 perspective matrix. */
export type Homography = number[];

/**
 * Perspective transform mapping each src[i] onto dst[i] (exactly 4 pairs).
 * Returns null when the points are degenerate (collinear / repeated).
 */
export function computeHomography(src: WallPoint[], dst: WallPoint[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  // Solve the 8x8 system A h = b for h = [a b c d e f g h], with i = 1.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [...h, 1];
}

/**
 * Least-squares affine fit (scale, rotation, shear and offset; no perspective)
 * from src points onto dst points, returned in homography form [a b c; d e f; 0 0 1].
 * With only four hand-placed points, a full perspective fit amplifies small
 * placement errors until the mapping flips; an affine fit averages them out
 * and can never flip, which matters more here than exact corners.
 */
export function computeAffine(src: WallPoint[], dst: WallPoint[]): Homography | null {
  if (src.length < 3 || src.length !== dst.length) return null;
  // normal equations: (AᵀA) [a b c] = Aᵀu and (AᵀA) [d e f] = Aᵀv, rows of A = [x y 1]
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  let sxu = 0, syu = 0, su = 0, sxv = 0, syv = 0, sv = 0;
  src.forEach(({ x, y }, i) => {
    const { x: u, y: v } = dst[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    sxu += x * u; syu += y * u; su += u; sxv += x * v; syv += y * v; sv += v;
  });
  const n = src.length;
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const abc = solve(M, [sxu, syu, su]);
  const def = solve(M, [sxv, syv, sv]);
  if (!abc || !def) return null;
  return [...abc, ...def, 0, 0, 1];
}

export function applyHomography(H: Homography, p: WallPoint): WallPoint {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * True when the four points (in order) form a convex quad with a usable area.
 * Guards against a calibration where Ishan pointed at the wrong corner or the
 * tracker glitched.
 */
export function isUsableQuad(pts: WallPoint[], minArea = 0.002): boolean {
  if (pts.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2 >= minArea;
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
