// Owns the app's localStorage keys by registry id: measures what the app stores,
// writes through one quota-aware path, and clears only keys it owns. Keys it does
// not own are never read, written or removed here.
const AppStorage = (() => {
  // localStorage quotas count UTF-16 code units, two bytes each.
  const BYTES_PER_UNIT = 2;
  const OWNED_IDS = Object.freeze(Object.keys(STORAGE_KEYS));

  function isQuotaError(e) {
    return (
      e !== null &&
      typeof e === "object" &&
      (e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        e.code === 22 ||
        e.code === 1014)
    );
  }

  function keyFor(id) {
    if (!Object.prototype.hasOwnProperty.call(STORAGE_KEYS, id)) {
      throw new Error(`unknown storage id: ${id}`);
    }
    return STORAGE_KEYS[id];
  }

  function usage() {
    const items = OWNED_IDS.map((id) => {
      const key = STORAGE_KEYS[id];
      const value = localStorage.getItem(key);
      const present = value !== null;
      const bytes = present ? (key.length + value.length) * BYTES_PER_UNIT : 0;
      return { id, key, present, bytes };
    });
    const totalBytes = items.reduce((n, item) => n + item.bytes, 0);
    return { items, totalBytes };
  }

  function write(id, value) {
    const key = keyFor(id);
    try {
      localStorage.setItem(key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: isQuotaError(e) ? "quota" : "unavailable" };
    }
  }

  function clear(id) {
    localStorage.removeItem(keyFor(id));
  }

  function clearAll() {
    OWNED_IDS.forEach(clear);
  }

  return Object.freeze({ usage, write, clear, clearAll, OWNED_IDS });
})();
