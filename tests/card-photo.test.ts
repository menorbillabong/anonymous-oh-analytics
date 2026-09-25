import assert from 'node:assert/strict';
import {cardPhotoUrl} from '../lib/card-photo.ts';

const original='https://pbs.twimg.com/media/Example_123.jpg?name=orig';
assert.equal(cardPhotoUrl(original),'https://pbs.twimg.com/media/Example_123.jpg?name=small');
assert.equal(original,'https://pbs.twimg.com/media/Example_123.jpg?name=orig');
assert.equal(cardPhotoUrl('https://pbs.twimg.com/media/Example?format=png&name=large'),'https://pbs.twimg.com/media/Example?format=png&name=small');
assert.equal(cardPhotoUrl('https://pbs.twimg.com/media/Example.jpg:orig'),'https://pbs.twimg.com/media/Example.jpg?name=small');
assert.equal(cardPhotoUrl(cardPhotoUrl(original)),cardPhotoUrl(original));
for(const unchanged of [
 'https://example.com/photo.jpg?name=orig',
 'https://pbs.twimg.com.evil.test/media/photo.jpg?name=orig',
 'https://pbs.twimg.com/profile_images/photo.jpg',
 'https://pbs.twimg.com/ext_tw_video_thumb/photo.jpg',
 'https://pbs.twimg.com/media/photo.gif?name=orig',
 'https://pbs.twimg.com/media/photo?format=gif&name=orig',
 'https://pbs.twimg.com/media/photo',
 'http://pbs.twimg.com/media/photo.jpg',
 'https://user:password@pbs.twimg.com/media/photo.jpg',
 'https://pbs.twimg.com:444/media/photo.jpg',
 'data:image/png;base64,abc','blob:local-test','/local-image.jpg','not a URL','',
])assert.equal(cardPhotoUrl(unchanged),unchanged);
console.log('card-photo: all assertions passed');
