import 'server-only';
import {JWT} from 'google-auth-library';
import {GOOGLE_SHEETS_MAX_ROWS,planSheetUpdates,type SheetPost} from './google-sheets-plan';

const SHEETS_SCOPE='https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API='https://sheets.googleapis.com/v4/spreadsheets';

function a1Tab(tabName:string){return `'${tabName.replaceAll("'", "''")}'`}

async function accessToken(){
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key=process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!email||!key)throw new Error('GOOGLE_SHEETS_SERVER_NOT_CONFIGURED');
  const auth=new JWT({email,key,scopes:[SHEETS_SCOPE]});
  const response=await auth.getAccessToken();
  if(!response.token)throw new Error('GOOGLE_SHEETS_AUTH_FAILED');
  return response.token;
}

async function googleRequest(url:string,token:string,init?:RequestInit){
  const response=await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(init?.headers||{})},cache:'no-store'});
  if(!response.ok){
    const code=response.status;
    if(code===403)throw new Error('GOOGLE_SHEETS_PERMISSION_DENIED');
    if(code===404)throw new Error('GOOGLE_SHEETS_NOT_FOUND');
    throw new Error(`GOOGLE_SHEETS_API_${code}`);
  }
  return response.json();
}

export async function syncGoogleSheet(tabName:string,posts:SheetPost[],sheetMonth=''){
  const spreadsheetId=process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if(!spreadsheetId)throw new Error('GOOGLE_SHEETS_SERVER_NOT_CONFIGURED');
  const token=await accessToken();
  const readRange=`${a1Tab(tabName)}!A1:S${GOOGLE_SHEETS_MAX_ROWS}`;
  const readUrl=`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(readRange)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const sheet=await googleRequest(readUrl,token) as {values?:unknown[][]};
  const plan=planSheetUpdates(tabName,sheet.values||[],posts,sheetMonth);

  if(plan.updates.length){
    await googleRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,token,{
      method:'POST',
      body:JSON.stringify({valueInputOption:'RAW',data:plan.updates}),
    });
  }

  return plan;
}

