import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityRecorder} from '../lib/account-activity.ts';

test('visible interactions count without requiring a new login; hidden tabs do not', async () => {
  let time = 1; let calls = 0;
  const recorder = createActivityRecorder(async () => { calls++; }, () => time);
  await recorder.touch(false); assert.equal(calls, 0);
  await recorder.touch(true); assert.equal(calls, 1);
  await recorder.touch(true); assert.equal(calls, 1);
  time += 300_000; await recorder.touch(true); assert.equal(calls, 2);
  time += 300_000; recorder.stop(); await recorder.touch(true); assert.equal(calls, 2);
});

test('failed activity recording retries later without blocking or flooding', async () => {
  let time = 1; let calls = 0;
  const recorder = createActivityRecorder(async () => { calls++; if (calls === 1) throw Error('offline'); }, () => time);
  await recorder.touch(true); await recorder.touch(true); assert.equal(calls, 1);
  time += 60_000; await recorder.touch(true); assert.equal(calls, 2);
});

test('concurrent activity events send only one request', async () => {
  let calls = 0; let release!: () => void;
  const recorder = createActivityRecorder(() => { calls++; return new Promise<void>(resolve => { release = resolve; }); });
  const first = recorder.touch(true);
  await recorder.touch(true); assert.equal(calls, 1);
  release(); await first;
});
