/** localStorage that never throws (private windows, blocked storage). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`air-writer:${key}`);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function loadRaw<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`air-writer:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`air-writer:${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
