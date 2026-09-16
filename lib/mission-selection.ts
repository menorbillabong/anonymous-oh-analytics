export type MissionSelectionPeriod = {id:string;start_date:string;end_date:string;per_user_limit:number|null};
export type MissionSelection = {post_id:number;period_id:string;mission_profile_id:number};

// Dates are normalized by the existing post-date helper before this predicate.
export function eligibleForMissionPeriod(post:{id:string|number;counting_excluded?:boolean;special_reward?:number}, date:string, period:MissionSelectionPeriod, selections:MissionSelection[], profileReward=0){
 const assignment=selections.find(row=>String(row.post_id)===String(post.id));
 if(assignment)return assignment.period_id===period.id;
 return !post.counting_excluded&&!!date&&date>=period.start_date&&date<=period.end_date&&Number(post.special_reward||0)<=0&&profileReward<=0;
}

export function missionSelectionError(error:{message?:string}){
 const message=error.message||'';
 if(message.includes('MISSION_PERIOD_LIMIT'))return 'Você atingiu o limite deste período. Desmarque uma publicação para selecionar outra.';
 if(message.includes('MISSION_PERIOD_ALREADY_ASSIGNED'))return 'Esta publicação já está selecionada em outro período. Atualize a lista.';
 if(message.includes('MISSION_PERIOD_HAS_BONUS'))return 'Esta publicação já está vinculada a uma missão com bônus.';
 if(message.includes('MISSION_PERIOD_INELIGIBLE'))return 'Esta publicação não está elegível pelas datas ou pertence a um período fechado.';
 if(message.includes('MISSION_PERIOD_PROFILE'))return 'Escolha um perfil ativo, seu, com bônus maior que zero.';
 if(message.includes('MISSION_PERIOD_STALE'))return 'A seleção foi alterada em outra janela. Atualize a lista antes de tentar novamente.';
 if(message.includes('fechado'))return 'O período desta publicação está fechado e não permite alterações de classificação.';
 return 'Não foi possível salvar. Atualize a lista e tente novamente.';
}
