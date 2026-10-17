'use strict';
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const H = require('./lib/browser-harness');
class Client {
  constructor() { this.messages = []; }
  async open(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      this.ws.once('error', reject);
      this.ws.on('message', data => {
        const message = JSON.parse(data);
        if (message.type === 'protocol:hello') return this.send({ type: 'protocol:hello', protocolVersion: 1 });
        if (message.type === 'protocol:ready') return resolve();
        this.messages.push(message);
      });
    });
    return this;
  }
  send(message) { this.ws.send(JSON.stringify(message)); }
  async wait(predicate, from = 0) {
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      const message = this.messages.slice(from).find(predicate);
      if (message) return message;
      await H.sleep(20);
    }
    throw Error('Timed out: ' + predicate + ' // ' + JSON.stringify(this.messages.slice(-3)).slice(0, 700));
  }
}
(async () => {
  const server = await H.startServer({ port: 19859, env: { ASOC_COLUMN_REVEAL_DELAY_MS: '150' } });
  const clients = [];
  try {
    const login = await server.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' });
    const gm = await new Client().open(server.port); clients.push(gm);
    gm.send({ type: 'host:recover', gmToken: login.data.token });
    await gm.wait(m => m.type === 'host:recovered');
    const columns = Object.fromEntries(Object.entries({ A: 'sail', B: 'moon', C: 'fire', D: 'stone' }).map(([key, solution]) => [key, { solution, clues: ['one', 'two', 'three', 'four'] }]));
    const response = await fetch(server.base + '/api/games', { method: 'POST', headers: { 'content-type': 'application/json', 'x-gm-token': login.data.token }, body: JSON.stringify({ title: 'Spectra Automatic Fixture', difficulty: 'GREEN', columns, finalSolution: 'splash' }) });
    assert.equal(response.status, 200);
    const saved = await response.json();
    gm.send({ type: 'gm:switchGame', gameId: saved.game.id });
    await gm.wait(m => m.type === 'gm:switchGame:ack');
    const players = [];
    for (let i = 0; i < 5; i++) {
      const name = `Spectra Hero ${i}`;
      const token = await H.heroToken(server, name);
      const player = await new Client().open(server.port); clients.push(player); players.push(player);
      player.send({ type: 'room:join', authToken: token, roomCode: 'MASTER', name });
      await player.wait(m => m.type === 'join:success');
    }
    gm.send({ type: 'gm:setRoomMode', mode: 'BATTLE' });
    await gm.wait(m => m.type === 'state:public' && m.roomMode === 'BATTLE_ARMED');
    players.forEach(player => player.send({ type: 'ritual:join' }));
    await gm.wait(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === 5);
    gm.send({ type: 'gm:timerLaunchCountdown' }); await H.sleep(200);
    gm.send({ type: 'gm:timerStart' });
    await gm.wait(m => m.type === 'state:public' && m.roomMode === 'BATTLE');
    gm.send({ type: 'gm:command', command: 'revealCell', payload: { cell: 'A1', reveal: true }, cmdId: 'spectra-clue-1' });
    await gm.wait(m => m.type === 'state:public' && m.cells?.A1?.revealed === true);
    const mode = async value => {
      const from = gm.messages.length;
      gm.send({ type: 'gm:spectral:mode', mode: value });
      await gm.wait(m => m.type === 'spectral:state' && m.state.mode === value, from);
    };
    const guess = async (text, verdict) => {
      await H.sleep(400);
      const from = gm.messages.length;
      players[0].send({ type: 'chat:guess', text });
      const frame = await gm.wait(m => m.messages?.some(x => x.text === text && (x.verdict || null) === verdict), from);
      return frame.messages.find(x => x.text === text);
    };
    await mode('MANUAL'); await guess('A SAIL', null);
    await mode('ASSISTED');
    const assisted = await guess('I saw a sail 😂', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === assisted.id));
    await mode('AUTONOMOUS');
    const typo = await guess('A saill', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === typo.id));
    await guess('D sail', 'wrong');
    const column = await guess('I saw a sail :D', 'correct');
    assert.equal(column.target, 'A');
    await gm.wait(m => m.type === 'state:public' && m.cells?.A5?.revealed === true);
    await mode('ASSISTED');
    const finalReview = await guess('K splash', null);
    await gm.wait(m => m.type === 'spectral:state' && m.state.pending.some(p => p.messageId === finalReview.id));
    await mode('AUTONOMOUS');
    const final = await guess('perhaps splash over here K 😂', 'correct');
    assert.equal(final.target, 'FINAL');
    await gm.wait(m => m.type === 'score:finalReveal' && m.correctSolution === 'splash');
    assert.equal(gm.messages.filter(m => m.type === 'score:event' && m.target === 'A').length, 1);
    console.log('PASS Spectra live battle: manual unchanged; assisted column/final queued; automatic exact column/final accepted and revealed without GM clicks; typo queued, wrong column rejected, one column score award');
  } finally { clients.forEach(client => client.ws?.terminate()); await server.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
