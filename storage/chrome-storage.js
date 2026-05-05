import { CACHE_TTL_MS, STORAGE_KEYS } from "../config.js";

export async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

export async function setStorage(values) {
  return chrome.storage.local.set(values);
}

export async function clearCache() {
  await chrome.storage.local.remove(STORAGE_KEYS.cache);
}

export function isCacheValid(cache) {
  if (!cache || !cache.fetchedAt || !cache.date || !Array.isArray(cache.entries)) {
    return false;
  }
  const age = Date.now() - cache.fetchedAt;
  return age >= 0 && age <= CACHE_TTL_MS;
}
