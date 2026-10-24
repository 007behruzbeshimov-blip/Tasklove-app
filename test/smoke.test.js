'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'sevgi1234';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, logs) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early (${child.exitCode}).\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server hali ko'tarilmagan.
    }
    await delay(60);
  }
  throw new Error(`Server did not become healthy.\n${logs()}`);
}

async function startServer({ port, dbPath, dataDir }) {
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DB_PATH: dbPath,
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child, () => output);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return {
    child,
    baseUrl,
    output: () => output,
  };
}

async function stopServer(instance) {
  const { child } = instance;
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5000).then(() => false),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

class Client {
  constructor(baseUrl, label) {
    this.baseUrl = baseUrl;
    this.label = label;
    this.cookie = '';
  }

  async request(route, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookies = response.headers.getSetCookie?.() || [];
    if (setCookies.length) {
      this.cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    }

    let payload = null;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      payload = await response.json();
    }
    return { status: response.status, payload, response };
  }

  async register(name, username) {
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: { name, username, password: PASSWORD },
    });
    assert.equal(result.status, 201, `${this.label} registration failed: ${JSON.stringify(result.payload)}`);
    return result.payload.user;
  }

  async login(username) {
    const result = await this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password: PASSWORD },
    });
    assert.equal(result.status, 200, `${this.label} login failed: ${JSON.stringify(result.payload)}`);
    return result.payload.user;
  }

  async state() {
    const result = await this.request('/api/state');
    assert.equal(result.status, 200, `${this.label} state failed: ${JSON.stringify(result.payload)}`);
    return result.payload;
  }
}

async function openEventStream(client) {
  const controller = new AbortController();
  const response = await fetch(`${client.baseUrl}/api/events`, {
    headers: { Accept: 'text/event-stream', Cookie: client.cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function nextEvent(name) {
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventName = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (eventName === name) {
          return JSON.parse(data);
        }
        continue;
      }

      const { value, done } = await reader.read();
      if (done) throw new Error(`Event stream ended while waiting for ${name}.`);
      buffer += decoder.decode(value, { stream: true });
    }
  }

  return {
    nextEvent,
    close() {
      controller.abort();
      reader.cancel().catch(() => {});
    },
  };
}

test('tasklove full API, realtime, persistence and deletion flow', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasklove-smoke-'));
  const dbPath = path.join(tempDir, 'smoke.db');
  const dataDir = tempDir;
  let server = await startServer({ port, dbPath, dataDir });
  let stream = null;

  try {
    const baseUrl = server.baseUrl;
    const alice = new Client(baseUrl, 'alice');
    const bob = new Client(baseUrl, 'bob');
    const charlie = new Client(baseUrl, 'charlie');

    const aliceUser = await alice.register('Alice Yurak', 'alice_yurak');
    const bobUser = await bob.register('Bob Yurak', 'bob_yurak');
    const charlieUser = await charlie.register('Charlie Yurak', 'charlie_yurak');
    assert.equal((await alice.state()).users.length, 3);
    assert.equal((await alice.state()).me.id, aliceUser.id);

    // 1x1 transparent PNG for testing proof images
    const testProofImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYAAAAAElFTkSuQmCC';

    const soloResult = await alice.request('/api/tasks', {
      method: 'POST',
      body: {
        title: 'Bob uchun kichik syurpriz',
        description: 'Bir piyola issiq choy tayyorlang.',
        mode: 'solo',
        category: 'care',
        participant_ids: [bobUser.id],
      },
    });
    assert.equal(soloResult.status, 201);
    const soloTaskId = soloResult.payload.taskId;

    const raceResult = await alice.request('/api/tasks', {
      method: 'POST',
      body: {
        title: 'Poyga: birinchi bo‘lgan g‘olib',
        description: 'Ikki yurak bir vaqtda bosadi.',
        mode: 'open',
        category: 'adventure',
      },
    });
    assert.equal(raceResult.status, 201);
    const raceTaskId = raceResult.payload.taskId;

    const sharedResult = await alice.request('/api/tasks', {
      method: 'POST',
      body: {
        title: 'Birgalikda yulduzlarga qarash',
        description: 'Birgalikdagi kichik sarguzasht.',
        mode: 'shared',
        category: 'date',
        participant_ids: [bobUser.id, charlieUser.id],
      },
    });
    assert.equal(sharedResult.status, 201);
    const sharedTaskId = sharedResult.payload.taskId;

    await assert.rejects(
      async () => {
        const result = await alice.request(`/api/tasks/${soloTaskId}/complete`, { method: 'POST' });
        assert.equal(result.status, 403);
        throw new Error(result.payload.error);
      },
      /o'z vazifangizni/i,
    );

    stream = await openEventStream(charlie);
    await stream.nextEvent('ready');
    const syncPromise = stream.nextEvent('sync');
    const notifyTask = await alice.request('/api/tasks', {
      method: 'POST',
      body: {
        title: 'Real vaqt sinovi',
        mode: 'open',
        category: 'surprise',
      },
    });
    assert.equal(notifyTask.status, 201);
    const syncEvent = await Promise.race([
      syncPromise,
      delay(4000).then(() => { throw new Error('SSE sync event did not arrive.'); }),
    ]);
    assert.equal(syncEvent.kind, 'task.created');
    assert.equal(syncEvent.taskId, notifyTask.payload.taskId);
    stream.close();
    stream = null;

    const beforeRace = await charlie.state();
    const beforePoints = new Map(beforeRace.users.map((user) => [user.id, user.points]));

    const [bobRace, charlieRace] = await Promise.all([
      bob.request(`/api/tasks/${raceTaskId}/complete`, { method: 'POST', body: { proof_image: testProofImage } }),
      charlie.request(`/api/tasks/${raceTaskId}/complete`, { method: 'POST', body: { proof_image: testProofImage } }),
    ]);
    const statuses = [bobRace.status, charlieRace.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([bobRace.payload, charlieRace.payload]));

    const afterRace = await charlie.state();
    const raceTask = afterRace.tasks.find((task) => task.id === raceTaskId);
    assert.equal(raceTask.status, 'completed');
    assert.ok(raceTask.completer);
    const winnerId = raceTask.completer.id;
    const charlieWonRace = winnerId === charlieUser.id;
    assert.ok(winnerId === bobUser.id || winnerId === charlieUser.id);
    const winnerPoints = afterRace.users.find((user) => user.id === winnerId).points;
    const beforeWinnerPoints = beforePoints.get(winnerId) || 0;
    assert.equal(winnerPoints, beforeWinnerPoints + 1);

    const soloComplete = await bob.request(`/api/tasks/${soloTaskId}/complete`, { method: 'POST', body: { proof_image: testProofImage } });
    assert.equal(soloComplete.status, 200);
    assert.equal(soloComplete.payload.pointsEarned, 1);
    const afterSolo = await bob.state();
    const soloTask = afterSolo.tasks.find((task) => task.id === soloTaskId);
    assert.equal(soloTask.status, 'completed');
    assert.equal(soloTask.completer.id, bobUser.id);
    assert.equal(afterSolo.completions.filter((item) => item.task_title === 'Bob uchun kichik syurpriz').length, 1);

    const sharedBefore = await bob.state();
    const sharedTask = sharedBefore.tasks.find((task) => task.id === sharedTaskId);
    assert.equal(sharedTask.can_complete, true);
    assert.equal(sharedTask.participants.length, 2);

    const profileUpdate = await charlie.request('/api/profile', {
      method: 'PATCH',
      body: {
        display_name: 'Charlie Gul',
        bio: 'Yulduzlar va issiq choy.',
        emoji: '🌙',
        accent: '#6968a8',
      },
    });
    assert.equal(profileUpdate.status, 200);
    const charlieAfterEdit = (await charlie.state()).users.find((user) => user.id === charlieUser.id);
    assert.equal(charlieAfterEdit.display_name, 'Charlie Gul');
    assert.equal(charlieAfterEdit.emoji, '🌙');
    assert.equal(charlieAfterEdit.bio, 'Yulduzlar va issiq choy.');

    const pointsBeforeDelete = (await charlie.state()).users
      .find((user) => user.id === charlieUser.id).points;

    // Ma'lumotlar qayta ishga tushirilgandan keyin ham saqlanishi kerak.
    const oldCookie = charlie.cookie;
    await stopServer(server);
    server = await startServer({ port, dbPath, dataDir });
    charlie.baseUrl = server.baseUrl;
    charlie.cookie = oldCookie;
    bob.baseUrl = server.baseUrl;
    alice.baseUrl = server.baseUrl;

    const afterRestart = await charlie.state();
    assert.equal(afterRestart.me.display_name, 'Charlie Gul');
    assert.equal(afterRestart.tasks.length, 4);
    assert.equal(afterRestart.completions.length, 2);

    // Alice o'z akkauntini o'chiradi. Uning vazifalari o'chadi, ammo boshqa
    // odamlar bajarganda yozilgan tarixiy natijalar saqlanib qoladi.
    const aliceDelete = await alice.request('/api/account', {
      method: 'DELETE',
      body: { password: PASSWORD, confirm: 'alice_yurak' },
    });
    assert.equal(aliceDelete.status, 200);
    const afterAliceDelete = await charlie.state();
    assert.equal(afterAliceDelete.users.some((user) => user.username === 'alice_yurak'), false);
    assert.equal(afterAliceDelete.tasks.some((task) => task.creator.id === aliceUser.id), false);
    const bobHistory = afterAliceDelete.completions.find(
      (item) => item.user_id === bobUser.id && item.task_title === 'Bob uchun kichik syurpriz',
    );
    assert.ok(bobHistory, 'Boshqa foydalanuvchining g‘alaba tarixi saqlanishi kerak.');
    assert.equal(bobHistory.task_id, null);

    // Bob o'z akkauntini o'chiradi: uning shaxsiy natijalari ham o'chadi.
    const bobDelete = await bob.request('/api/account', {
      method: 'DELETE',
      body: { password: PASSWORD, confirm: 'bob_yurak' },
    });
    assert.equal(bobDelete.status, 200);
    const finalState = await charlie.state();
    assert.equal(finalState.users.length, 1);
    assert.equal(finalState.users[0].id, charlieUser.id);
    assert.equal(finalState.completions.some((item) => item.user_id === bobUser.id), false);
    if (charlieWonRace) {
      assert.equal(finalState.completions.some((item) => item.user_id === charlieUser.id), true);
    } else {
      assert.equal(finalState.completions.some((item) => item.user_id === charlieUser.id), false);
    }
    assert.equal(
      finalState.users.find((user) => user.id === charlieUser.id).points,
      pointsBeforeDelete,
    );

    const staleSession = await alice.request('/api/state');
    assert.equal(staleSession.status, 401);
  } finally {
    if (stream) stream.close();
    await stopServer(server);
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows ba'zan SQLite faylini bir zum ushlab turadi; test natijasiga ta'sir qilmaydi.
    }
  }
});
