'use client';

import {useEffect} from 'react';
import {supabase} from '@/lib/supabase';
import {createActivityRecorder} from '@/lib/account-activity';

export default function AccountActivity({userId}: {userId: string}) {
  useEffect(() => {
    const recorder = createActivityRecorder(async () => {
      const {error} = await supabase.rpc('record_account_activity');
      if (error) throw error;
    });
    const touch = () => { void recorder.touch(document.visibilityState === 'visible'); };
    touch();
    const events = ['pointerdown', 'keydown', 'scroll', 'focus', 'online'] as const;
    for (const event of events) window.addEventListener(event, touch, {passive: true});
    document.addEventListener('visibilitychange', touch);
    return () => {
      recorder.stop();
      for (const event of events) window.removeEventListener(event, touch);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [userId]);
  return null;
}
