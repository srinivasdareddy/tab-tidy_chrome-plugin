// Keep meaningful URL bytes intact; smart mode removes only known tracking fields.
export function matchingUrl(url, { smartMatching = false } = {}) {
  if (!smartMatching) return url;
  try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return url; } catch { return url; }
  const hashIndex = url.indexOf('#');
  const fragment = hashIndex < 0 ? '' : url.slice(hashIndex);
  const page = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = page.indexOf('?');
  if (queryIndex < 0) return url;
  const fields = page.slice(queryIndex + 1).split('&');
  const kept = fields.filter(field => {
    let name;
    try { name = decodeURIComponent(field.split('=')[0].replaceAll('+', ' ')).toLowerCase(); } catch { return true; }
    return !/^utm_/.test(name) && !['gclid', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga', '_gl'].includes(name);
  });
  if (kept.length === fields.length) return url;
  return page.slice(0, queryIndex) + (kept.length ? `?${kept.join('&')}` : '') + fragment;
}

function eligible(tab) {
  return Number.isInteger(tab.id) && tab.id >= 0 && typeof tab.url === 'string' && tab.url.length > 0 && !tab.pendingUrl;
}

export function findDuplicateGroups(tabs, options = {}) {
  const groups = new Map();
  for (const tab of tabs) {
    if (!eligible(tab)) continue;
    const key = JSON.stringify([Boolean(tab.incognito), matchingUrl(tab.url, options)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }
  return [...groups.values()].filter(copies => copies.length > 1).map(copies => {
    const [keeper] = [...copies].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.active) - Number(a.active) || a.id - b.id);
    return { url: keeper.url, keeper, duplicates: copies.filter(tab => tab.id !== keeper.id) };
  });
}

export async function closeDuplicates(api, selected, options = {}) {
  const result = { closed: 0, skipped: 0, failed: 0 };
  for (const candidate of selected) {
    // Re-query for every close: a previously retained tab may have been closed or navigated.
    const tabs = await api.query({});
    const current = tabs.find(tab => tab.id === candidate.id);
    const hasOtherCopy = current && tabs.some(tab =>
      tab.id !== current.id && eligible(tab) && matchingUrl(tab.url, options) === matchingUrl(current.url, options) && Boolean(tab.incognito) === Boolean(current.incognito));
    if (!current || !eligible(current) || current.url !== candidate.url || Boolean(current.incognito) !== Boolean(candidate.incognito) || !hasOtherCopy) {
      result.skipped++;
      continue;
    }
    // Saving recovery data must succeed before a tab can be closed.
    await options.onBeforeClose?.(current);
    try {
      await api.remove(current.id);
    } catch {
      result.failed++;
      continue;
    }
    result.closed++;
    await options.onClosed?.(current);
  }
  return result;
}
