export function cleanName(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('invalid-profile');
  return value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 20) || 'Anonymous';
}

export async function validatePlayer(body) {
  if (!body || typeof body.playerId !== 'string' || typeof body.playerToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.playerId || '') ||
    !/^[0-9a-f]{64}$/i.test(body.playerToken || '') || !Number.isSafeInteger(body.nameVersion) || body.nameVersion < 1) {
    throw new Error('invalid-profile');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.playerToken));
  return {
    id: body.playerId, name: cleanName(body.name), nameVersion: body.nameVersion,
    tokenHash: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''),
  };
}

export function savePlayer(db, player) {
  // Older score/profile requests cannot revert a more recent name change.
  return db.prepare(`INSERT INTO leaderboard_players(id,token_hash,name,name_version) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=CASE WHEN excluded.name_version > leaderboard_players.name_version THEN excluded.name ELSE leaderboard_players.name END,
      name_version=MAX(leaderboard_players.name_version,excluded.name_version)
    WHERE leaderboard_players.token_hash=excluded.token_hash
    RETURNING id,name`)
    .bind(player.id, player.tokenHash, player.name, player.nameVersion).first();
}
