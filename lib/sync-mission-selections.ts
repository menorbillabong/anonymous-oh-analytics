type MissionSyncClient = {
  rpc: (name: 'sync_my_mission_period_selections') => PromiseLike<{error: unknown}>;
};

export const missionSyncPendingNotice = 'Publicações salvas. A vinculação automática está pendente; abra Períodos de Missão e clique em Atualizar lista para tentar novamente.';

// Call only AFTER the post write commits. Never repeat a successful insertion
// because a separate, idempotent reconciliation failed.
export async function syncMissionSelectionsAfterSave(client: MissionSyncClient): Promise<string> {
  try {
    const {error} = await client.rpc('sync_my_mission_period_selections');
    return error ? missionSyncPendingNotice : '';
  } catch {
    return missionSyncPendingNotice;
  }
}
