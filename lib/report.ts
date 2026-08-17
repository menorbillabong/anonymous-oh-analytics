import {monthlyReward,postContribution} from './reward';
import {postDateParts,postPublishedDate} from './post-date';
export type ReportPeriod={year:number;month:number};
export function currentReportPeriod(now=new Date()):ReportPeriod{const parts=postDateParts(now);return{year:parts?.year||now.getFullYear(),month:parts?.month??now.getMonth()}}
export function postDate(post:any){return postPublishedDate(post)}
export function postsForPeriod(posts:any[],period:ReportPeriod){return posts.filter(post=>{const parts=postDateParts(postPublishedDate(post));return parts&&parts.year===period.year&&parts.month===period.month})}
export function reportMetrics(posts:any[],capUnlocked=false){const reward=monthlyReward(posts,capUnlocked);const engagement=posts.reduce((total,post)=>total+Number(post.likes||0)+Number(post.comments||0)+Number(post.reposts||0),0);return{...reward,engagement}}
export function postReportCalculation(post:any){const likes=Number(post?.likes||0),missionReward=Number(post?.special_reward||0);return{likes,engagementReward:likes*2,missionReward,total:postContribution(post)}}


