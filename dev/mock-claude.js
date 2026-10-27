/* Test-only Artifact capabilities. All capability and database delivery uses a later task. */
(() => {
  'use strict';
  const config = window.__mockClaudeConfig || {};
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const later = fn => new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(fn()); } catch (error) { reject(error); }
  }, 0));
  const failure = code => Object.assign(new Error('Mock Claude: ' + code), { code });
  const store = new Map(), listeners = new Set();
  let serial = 0, refuseWrites = config.refuseWrites ?? null;
  const me = { id: 'riley', name: 'Riley Chen', avatarUrl: '', color: '#2b5bd7', email: '',
    isOwner: false, canEdit: config.canWrite !== false, ...config.me };
  const canWrite = config.canWrite === undefined ? true : config.canWrite;
  function collectionStore(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }
  function autoId(name) {
    let id;
    do { id = 'mock-' + ++serial; } while (collectionStore(name).has(id));
    return id;
  }
  for (const [name, docs] of Object.entries(config.seed || {})) {
    for (const { id, ...data } of docs) collectionStore(name).set(id || autoId(name), copy(data));
  }
  function docSnapshot(id, data) {
    const saved = copy(data);
    return { id, exists: data !== undefined, data: () => copy(saved) };
  }
  function notify(name) {
    for (const listener of listeners) if (listener.name === name) listener.deliver();
  }
  function change(name, id, data, merge = false) {
    const docs = collectionStore(name);
    if (merge && !docs.has(id)) throw failure('invalid_argument');
    if (data === undefined) docs.delete(id);
    else docs.set(id, copy(merge ? { ...docs.get(id), ...data } : data));
    notify(name);
  }
  function write(fn) {
    return later(() => {
      if (refuseWrites) throw failure(refuseWrites);
      if (canWrite === false) throw failure('not_granted');
      return fn();
    });
  }
  function query(name, ordering = null, maximum = null) {
    function snapshot() {
      let docs = [...collectionStore(name)].map(([id, data]) => docSnapshot(id, data));
      if (ordering) {
        const [field, direction] = ordering;
        docs.sort((a, b) => {
          const x = a.data()[field], y = b.data()[field];
          return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * (direction === 'desc' ? -1 : 1);
        });
      }
      if (maximum !== null) docs = docs.slice(0, maximum);
      return { docs };
    }
    return {
      doc(id = autoId(name)) {
        return {
          id,
          set: data => write(() => change(name, id, data)),
          update: patch => write(() => change(name, id, patch, true)),
          delete: () => write(() => change(name, id)),
          get: () => later(() => docSnapshot(id, collectionStore(name).get(id)))
        };
      },
      orderBy(field, direction = 'asc') {
        if (!['asc', 'desc'].includes(direction)) throw failure('invalid_argument');
        return query(name, [field, direction], maximum);
      },
      limit(n) {
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw failure('invalid_argument');
        return query(name, ordering, n);
      },
      onSnapshot(next, error) {
        let active = true;
        const listener = { name, deliver() {
          let snap;
          try { snap = snapshot(); } catch (err) {
            setTimeout(() => { if (active && error) error(err); }, 0);
            return;
          }
          setTimeout(() => { if (active) next(snap); }, 0);
        } };
        listeners.add(listener);
        listener.deliver();
        return () => { active = false; listeners.delete(listener); };
      }
    };
  }
  const user = {
    isOwner: () => later(() => me.isOwner),
    canEdit: () => later(() => me.canEdit),
    can: name => later(() => name === 'data.write' ? canWrite : null),
    id: () => later(() => me.id),
    me: () => later(() => copy(me)),
    profiles: ids => later(() => Object.fromEntries(ids.map(id => [id,
      { id, name: '', ...(id === me.id ? copy(me) : copy(config.people?.[id])) } ])))
  };
  const sample = (_input, _opts) => later(() => ({ text: 'Mock answer', truncated: false }));
  sample.json = (_input, _opts) => later(() => ({ text: 'Mock answer', truncated: false }));
  const namespaces = { db: { collection: name => query(name) }, user: config.user === null ? null : user, sample };
  window.claude = { use: name => later(() => Object.hasOwn(namespaces, name) ? namespaces[name] : null) };
  // Mutate through these helpers so subscribers see the same changes as capability writes.
  window.__mock = {
    docs: name => [...collectionStore(name)].map(([id, data]) => ({ id, ...copy(data) })),
    set: (name, id, data) => change(name, id, data),
    update: (name, id, patch) => change(name, id, patch, true),
    delete: (name, id) => change(name, id),
    get store() { return Object.fromEntries([...store].map(([name]) => [name, this.docs(name)])); },
    get refuseWrites() { return refuseWrites; },
    set refuseWrites(code) { refuseWrites = code; }
  };
})();
