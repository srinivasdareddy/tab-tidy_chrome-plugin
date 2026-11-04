export const tab = (id, url, extra = {}) => ({ id, url, title: `Page ${id}`, windowId: 1, index: id - 1, pinned: false, active: false, audible: false, incognito: false, status: 'complete', lastAccessed: Date.now() - 48 * 3600000, ...extra });

export function fakeBrowser(initial = []) {
  let tabs = structuredClone(initial);
  let nextId = 1000;
  let nextWindow = 100;
  const local = {};
  const session = {};
  const windows = new Map([...new Set(tabs.map(t => t.windowId))].map(id => [id, { id, incognito: Boolean(tabs.find(t => t.windowId === id).incognito), focused: false }]));
  const area = values => ({
    async get() { return structuredClone(values); },
    async set(update) { Object.assign(values, structuredClone(update)); },
  });
  const browser = {
    local, session,
    storage: { local: area(local), session: area(session) },
    failRemove: undefined,
    failCreate: false,
    tabs: {
      async query(options = {}) { return structuredClone(tabs.filter(t => options.windowId === undefined || t.windowId === options.windowId)); },
      async get(id) { const found = tabs.find(t => t.id === id); if (!found) throw new Error('Missing tab'); return structuredClone(found); },
      async move(id, { index }) {
        const current = tabs.find(t => t.id === id);
        if (!current) throw new Error('Missing tab');
        const ordered = tabs.filter(t => t.windowId === current.windowId).sort((a, b) => a.index - b.index);
        ordered.splice(ordered.indexOf(current), 1);
        ordered.splice(index, 0, current);
        ordered.forEach((t, i) => { t.index = i; });
        return structuredClone(current);
      },
      async remove(id) {
        if (id === browser.failRemove) throw new Error('Remove failed');
        const current = tabs.find(t => t.id === id);
        tabs = tabs.filter(t => t.id !== id);
        if (current && !tabs.some(t => t.windowId === current.windowId)) windows.delete(current.windowId);
      },
      async update(id, update) {
        const current = tabs.find(t => t.id === id);
        if (!current) throw new Error('Missing tab');
        if (update.active) for (const t of tabs) if (t.windowId === current.windowId) t.active = false;
        Object.assign(current, update);
        return structuredClone(current);
      },
      async create(properties) {
        if (browser.failCreate) throw new Error('Create failed');
        const window = windows.get(properties.windowId);
        if (!window) throw new Error('Missing window');
        const created = tab(nextId++, properties.url, { ...properties, incognito: window.incognito });
        if (created.active) for (const t of tabs) if (t.windowId === created.windowId) t.active = false;
        tabs.push(created);
        return structuredClone(created);
      },
    },
    windows: {
      async getAll() { return structuredClone([...windows.values()]); },
      async update(id, update) { if (!windows.has(id)) throw new Error('Missing window'); Object.assign(windows.get(id), update); },
      async create(properties) {
        if (browser.failCreate) throw new Error('Create failed');
        const window = { id: nextWindow++, incognito: Boolean(properties.incognito), focused: Boolean(properties.focused) };
        windows.set(window.id, window);
        const created = tab(nextId++, properties.url, { windowId: window.id, active: true, incognito: window.incognito });
        tabs.push(created);
        return { ...window, tabs: [structuredClone(created)] };
      },
    },
    list: () => structuredClone(tabs),
    change: (id, update) => Object.assign(tabs.find(t => t.id === id), update),
    add: value => tabs.push(structuredClone(value)),
  };
  return browser;
}
