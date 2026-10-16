import * as storage from './storage.js';

const FIELD = 'leaderboardPlayer';
let sessionProfile = null;

export function storedPlayer() {
  const profile = storage.get(FIELD, sessionProfile);
  return profile && typeof profile.playerId === 'string' && typeof profile.playerToken === 'string' ? profile : null;
}

export function playerProfile(name) {
  let profile = storedPlayer();
  if (!profile) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    profile = {
      playerId: crypto.randomUUID(),
      playerToken: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join(''),
      name: 'Anonymous', nameVersion: Date.now(), pending: true,
    };
  }
  profile = { ...profile };
  if (name !== undefined) {
    const clean = String(name).normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 20) || 'Anonymous';
    if (clean !== profile.name) {
      profile.name = clean;
      profile.nameVersion = Math.max(Date.now(), profile.nameVersion + 1);
      profile.pending = true;
    }
  }
  sessionProfile = profile;
  storage.set(FIELD, profile);
  return { ...profile };
}

export function profileSynced(sent) {
  const current = storedPlayer();
  if (!current || current.playerId !== sent.playerId || current.nameVersion !== sent.nameVersion) return;
  sessionProfile = { ...current, pending: false };
  storage.set(FIELD, sessionProfile);
}
