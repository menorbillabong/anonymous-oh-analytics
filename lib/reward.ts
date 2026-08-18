export const VIEW_REWARD_GOALS=[1000,3000,5000,8000,10000,15000,20000,25000,30000] as const;

export function viewReward(views:number){if(views<=1000)return 250;if(views<=3000)return 750;if(views<=5000)return 1250;if(views<=8000)return 2000;if(views<=10000)return 2500;if(views<=15000)return 3750;if(views<=20000)return 5000;if(views<=25000)return 6250;if(views<=30000)return 7500;return 12500}

export function viewGoalProgress(views:number){
 const current=Math.max(0,Number(views)||0);
 const nextGoal=VIEW_REWARD_GOALS.find(goal=>current<goal);
 const maximumReached=nextGoal===undefined;
 const goal=maximumReached?VIEW_REWARD_GOALS[VIEW_REWARD_GOALS.length-1]:nextGoal;
 const percent=maximumReached?100:Math.min(100,Math.round(current/goal*100));
 return{current,goal,percent,maximumReached};
}

export function minimumPostProgress(posts:number){
 const current=Math.max(0,Math.floor(Number(posts)||0));
 const goal=10;
 const reached=current>=goal;
 return{current,goal,percent:Math.min(100,Math.round(current/goal*100)),reached};
}
export function postContribution(p:any){return Number(p?.likes||0)*2+Number(p?.special_reward||0)}
export function monthlyReward(posts:any[],_legacyCapUnlocked=false){const views=posts.reduce((a,p)=>a+Number(p.views||0),0);const likes=posts.reduce((a,p)=>a+Number(p.likes||0),0);const special=posts.reduce((a,p)=>a+Number(p.special_reward||0),0);const base=posts.length>=10?800:0;const viewsReward=posts.length?viewReward(views):0;const raw=base+viewsReward+likes*2+special;return{views,likes,special,base,viewsReward,engagementReward:likes*2,raw,total:raw}}


