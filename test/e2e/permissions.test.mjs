import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

// Security audit (2.0.0-beta.8): the music page used to receive the camera and the
// microphone silently, and so did any page or frame shown in its view. Fake devices
// make the permission decision observable.
const profile = newProfile();
let h;
let server;
const CAPTURE = `navigator.mediaDevices.getUserMedia({ audio: true, video: true })
  .then(s => { s.getTracks().forEach(t => t.stop()); return 'granted'; }, e => e.name)`;

before(async () => {
  // A third-party page that YouTube Music could embed (loopback, test only).
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<script>${CAPTURE}.then(r => parent.postMessage(r, '*'))</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  h = await launch({ userData: profile, args: ['--use-fake-device-for-media-stream'] });
});
after(async () => {
  await h?.close();
  server?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('permissions: YouTube Music never gets the camera or the microphone', async () => {
  assert.equal(await h.ytm(CAPTURE), 'NotAllowedError');
  assert.equal(await h.ytm(`navigator.permissions.query({ name: 'camera' }).then(p => p.state)`), 'denied');
});

test('permissions: nor does a frame from another origin, even when the page delegates them', async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await h.ytm(`new Promise(resolve => {
    addEventListener('message', e => { if (e.origin === ${JSON.stringify(origin)}) resolve(e.data); });
    const frame = document.createElement('iframe');
    frame.allow = 'camera; microphone';
    frame.src = ${JSON.stringify(origin + '/')};
    document.body.append(frame);
  })`);
  assert.equal(result, 'NotAllowedError');
});

test('permissions: video fullscreen still works for YouTube Music', async () => {
  assert.equal(
    await h.ytm(`navigator.permissions.query({ name: 'camera' }).then(() => document.fullscreenEnabled)`),
    true,
  );
});
