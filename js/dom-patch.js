// ASOC keyed DOM patch.
//
// The GM surfaces (working board, Public View, Battle Comms) are rebuilt from
// authoritative state far more often than they actually change: a full
// state:public arrives every second while the timer runs, and a Shadow Broker
// board line re-renders the board every 40ms while it types out. Replacing
// the whole container's innerHTML on each of those detached the element
// under the GM's cursor mid-click (mousedown on the old node, mouseup on its
// replacement = no click), so board reveals and chat verdicts needed two or
// three attempts and the chat visibly flickered.
//
// patch() takes the render as an ordered list of { key, html } entries, one
// per top-level child. A child whose html is byte-identical to what it was
// built from last time is KEPT (same DOM node, same listeners, same hover);
// only new or changed entries are built. Code that mutates a patched node in
// place must call invalidate(node) so the next patch rebuilds it instead of
// trusting its stale source html.
const DomPatch = (() => {
  const KEY = '__asocPatchKey';
  const SRC = '__asocPatchHtml';

  function defaultCreate(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const elements = template.content.children;
    if (elements.length === 1) return elements[0];
    const wrapper = document.createElement('div');
    wrapper.style.display = 'contents';
    wrapper.appendChild(template.content);
    return wrapper;
  }

  // Duplicate keys would make two entries fight over one node; suffix them.
  function uniqueEntries(entries) {
    const seen = new Map();
    return entries
      .filter(entry => entry && typeof entry.html === 'string' && entry.html.trim())
      .map(entry => {
        const base = String(entry.key);
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        return { key: count ? `${base}#${count}` : base, html: entry.html };
      });
  }

  // Returns { changed, inserted } -- inserted lists the freshly built nodes so
  // callers can decorate only those (links, mentions, fit) instead of
  // re-walking nodes that were already decorated.
  function patch(container, entries, { create = defaultCreate } = {}) {
    const list = uniqueEntries(entries || []);
    const reusable = new Map();
    Array.from(container.children).forEach(child => {
      if (child[KEY] != null && !reusable.has(child[KEY])) reusable.set(child[KEY], child);
    });

    const inserted = [];
    const kept = new Set();
    const nodes = list.map(entry => {
      const existing = reusable.get(entry.key);
      if (existing && existing[SRC] === entry.html) {
        kept.add(existing);
        return existing;
      }
      const node = create(entry.html);
      node[KEY] = entry.key;
      node[SRC] = entry.html;
      inserted.push(node);
      return node;
    });

    let changed = inserted.length > 0;
    Array.from(container.childNodes).forEach(child => {
      if (!kept.has(child)) {
        container.removeChild(child);
        if (child.nodeType === 1) changed = true;
      }
    });

    nodes.forEach((node, index) => {
      const current = container.children[index];
      if (current !== node) {
        container.insertBefore(node, current || null);
        changed = true;
      }
    });

    return { changed, inserted };
  }

  function invalidate(node) {
    if (node) node[SRC] = null;
  }

  return { patch, invalidate };
})();

if (typeof window !== 'undefined') window.DomPatch = DomPatch;
if (typeof module !== 'undefined' && module.exports) module.exports = DomPatch;
