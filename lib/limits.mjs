// Guards for a public link: per-IP rate limit, daily cap, optional access code.
export function createLimits({ perIpPerHour = 3, perDay = 100, accessCode = '' } = {}) {
  const byIp = new Map();
  let day = new Date().toISOString().slice(0, 10), used = 0;
  return {
    check(ip, code, now = Date.now()) {
      if (accessCode && code !== accessCode) return { ok: false, status: 403, error: 'Access code is required.' };
      const today = new Date(now).toISOString().slice(0, 10);
      if (today !== day) { day = today; used = 0; }
      if (used >= perDay) return { ok: false, status: 429, error: 'Daily generation limit reached. Try again tomorrow.' };
      const recent = (byIp.get(ip) || []).filter(t => now - t < 3600_000);
      if (recent.length >= perIpPerHour) return { ok: false, status: 429, error: 'Too many requests from this device. Try again within an hour.' };
      recent.push(now); byIp.set(ip, recent); used++;
      return { ok: true };
    },
    stats: () => ({ day, used, perDay })
  };
}
