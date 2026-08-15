import {monthlyReward,postContribution} from './reward';
export type ReportPeriod={year:number;month:number};
export function currentReportPeriod(now=new Date()):ReportPeriod{return{year:now.getFullYear(),month:now.getMonth()}}
export function postDate(post:any){const value=post?.published_date||post?.created_at;if(!value)return null;const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value))?`${value}T12:00:00`:value);return Number.isNaN(date.getTime())?null:date}
export function postsForPeriod(posts:any[],period:ReportPeriod){return posts.filter(post=>{const date=postDate(post);return date&&date.getFullYear()===period.year&&date.getMonth()===period.month})}
export function reportMetrics(posts:any[],capUnlocked=false){const reward=monthlyReward(posts,capUnlocked);const engagement=posts.reduce((total,post)=>total+Number(post.likes||0)+Number(post.comments||0)+Number(post.reposts||0),0);return{...reward,engagement}}
export function postReportCalculation(post:any){const likes=Number(post?.likes||0),missionReward=Number(post?.special_reward||0);return{likes,engagementReward:likes*2,missionReward,total:postContribution(post)}}

