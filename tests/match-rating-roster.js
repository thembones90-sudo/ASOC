'use strict';
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { chromium } = require('playwright');
const H = require('./lib/browser-harness');

const PORT = 19494;
function peer(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];
    ws.on('error', reject);
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'protocol:hello') {
        ws.send(JSON.stringify({ type: 'protocol:hello', protocolVersion: 1 }));
        return;
      }
      inbox.push(m);
      for (const check of [...waiters]) check();
      if (m.type === 'protocol:ready') resolve({
        ws, inbox,
        send: message => ws.send(JSON.stringify(message)),
        wait: (predicate, label, after = 0) => new Promise((ok, fail) => {
          const timer = setTimeout(() => { const i = waiters.indexOf(check); if (i !== -1) waiters.splice(i, 1); fail(new Error('Timeout: ' + label)); }, 12000);
          function check() {
            const found = inbox.slice(after).find(predicate);
            if (!found) return;
            clearTimeout(timer);
            const i = waiters.indexOf(check); if (i !== -1) waiters.splice(i, 1);
            ok(found);
          }
          waiters.push(check);
          check();
        })
      });
    });
  });
}
async function action(p, payload, predicate, label) {
  const offset = p.inbox.length;
  const awaited = p.wait(predicate, label, offset);
  p.send(payload);
  return awaited;
}
(async () => {
  const s = await H.startServer({ port: PORT });
  const sockets = [];
  let browser;
  try {
    const gm = (await s.api('POST', '/api/auth/gm/login', { password: 'browser-gm-pass' })).data.token;
    assert.ok(gm);
    const host = await peer(s.base.replace('http', 'ws')); sockets.push(host.ws);
    const room = await action(host, { type: 'room:create', gameId: 'sample-game', gmToken: gm }, m => m.type === 'room:created', 'GM room created');
    const voters = [];
    for (let i = 0; i < 5; i++) {
      const name = 'VERDICT HERO ' + (i + 1);
      const token = await H.heroToken(s, name);
      const player = await peer(s.base.replace('http','ws')); sockets.push(player.ws);
      await action(player, { type:'room:join', authToken: token, roomCode:'MASTER', name }, m => m.type === 'join:success', 'player join ' + i);
      voters.push({ player, name });
    }
    for (let i = 0; i < voters.length; i++) {
      const offset = host.inbox.length;
      voters[i].player.send({ type:'ritual:join' });
      await host.wait(m => m.type === 'ritual:gmUpdate' && m.ritual?.joinedCount === i + 1, 'ritual vote ' + i, offset);
    }
    await action(host, { type: 'gm:timerStart' }, m => m.type === 'state:public' && m.roomMode === 'BATTLE', 'battle started');
    await action(host, { type: 'gm:command', command: 'revealAll', payload: {}, cmdId: 991 }, m => m.type === 'state:public' && m.gameComplete === true, 'complete match');
    await action(host, { type:'gm:finishGame' }, m => m.type === 'match:aftermath', 'aftermath');
    const roster0 = await action(host, { type:'gm:openRating' }, m => m.type === 'match:ratingRoster', 'first private roster');
    assert.equal(roster0.roster.length, 5);
    assert.equal(roster0.roster.filter(x => x.rating === null).length, 5);
    const r1 = await action(voters[0].player, { type:'match:rate', rating:9 }, m => m.type === 'match:ratingAck' && m.myRating === 9, 'first rating');
    assert.equal(r1.votesCount, 1);
    const hostOne = await host.wait(m => m.type === 'match:ratingRoster' && m.roster.some(x => x.name === voters[0].name && x.rating === 9), 'first GM-only verdict');
    assert.equal(hostOne.roster.length, 5);
    const r2 = await action(voters[1].player, { type:'match:rate', rating:6 }, m => m.type === 'match:ratingAck' && m.myRating === 6, 'second rating');
    assert.equal(r2.votesCount, 2);
    assert.equal(r2.average, 7.5);
    const updated = await host.wait(m => m.type === 'match:ratingRoster' && m.roster.some(x => x.name === voters[1].name && x.rating === 6), 'second GM-only verdict');
    assert.equal(updated.roster.filter(x => x.rating === null).length, 3);
    for(const v of voters) {
      assert.equal(v.player.inbox.filter(x => x.type === 'match:ratingRoster').length, 0, 'private ratings NEVER reach players');
      for (const m of v.player.inbox.filter(x => x.type === 'state:public' || x.type === 'match:rating')) {
        assert.equal('roster' in m, false, 'no roster in public messages');
        assert.equal('ratings' in m, false, 'no votes in public messages');
      }
    }
    const host2 = await peer(s.base.replace('http','ws')); sockets.push(host2.ws);
    const restored = await action(host2, { type:'host:recover', gmToken: gm }, m => m.type === 'match:ratingRoster', 'GM recovery restores private roster');
    assert.equal(restored.roster.length, 5);
    assert.equal(restored.roster.filter(x => x.rating !== null).length, 2);
    // Actual DOM: names and values, pending rows, and no HTML injection.
    browser = await chromium.launch(H.launchOptions());
    const page = await browser.newPage();
    await page.goto(s.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.MatchRating);
    const rendered = await page.evaluate(data => {
      MatchRating.update({ open: true, average: 7.5, eligibleCount: 5, votesCount: 2, matchId: 'test-1', roster: data }, {isHost:true, send:()=>{}});
      return {
        names: [...document.querySelectorAll('.match-rating-player-name')].map(x=>x.textContent),
        scores: [...document.querySelectorAll('.match-rating-player-result')].map(x=>x.textContent),
        button: document.querySelector('.match-rating-proceed')?.textContent,
        count: document.querySelector('.match-rating-roster-head')?.textContent
      };
    }, restored.roster);
    assert.equal(rendered.names.length, 5);
    assert.ok(rendered.scores.includes('9/10') && rendered.scores.includes('6/10'));
    assert.equal(rendered.scores.filter(x=>x==='WAITING').length, 3);
    assert.ok(rendered.button.includes('PROCEED TO RECOUNT'));
    // Real player flow: rating is optional to dismiss and remains dismissed
    // through server updates/reload without changing the GM's rating phase.
    const heroContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const heroPage = await H.openHeroPage(heroContext, s, await H.heroToken(s, voters[0].name));
    await heroPage.getByRole('dialog', { name: 'Rate this game', exact: true }).waitFor();
    await heroPage.locator('[data-rating="7"]').click();
    await heroPage.waitForFunction(() => document.querySelector('.match-rating-status')?.textContent.includes('RATING LOGGED // 7/10'));
    await host2.wait(m => m.type === 'match:ratingRoster' && m.roster.some(x => x.name === voters[0].name && x.rating === 7), 'real player vote retained');
    await heroPage.getByRole('button', { name: 'RETURN TO MENU', exact: true }).click();
    assert.equal(await heroPage.locator('.match-rating-overlay').count(), 0, 'player returns to underlying normal screen');
    assert.equal(await heroPage.locator('#game-screen').isVisible(), true);
    const voteUpdate = voters[1].player.inbox.length;
    voters[1].player.send({ type: 'match:rate', rating: 8 });
    await voters[1].player.wait(m => m.type === 'match:ratingAck' && m.myRating === 8, 'other player still rates', voteUpdate);
    await heroPage.waitForTimeout(200);
    assert.equal(await heroPage.evaluate(() => MatchRating.isOpen()), false, 'other votes cannot reopen dismissed panel');
    await heroPage.reload({ waitUntil: 'domcontentloaded' });
    await heroPage.waitForSelector('#game-screen.active');
    await heroPage.waitForTimeout(200);
    assert.equal(await heroPage.evaluate(() => MatchRating.isOpen()), false, 'dismissal survives reload while GM ratings remain open');
    await action(host2, { type: 'gm:openRating' }, m => m.type === 'match:rating' && m.open === true, 'GM rating phase still open');
    await heroPage.waitForTimeout(200);
    assert.equal(await heroPage.evaluate(() => MatchRating.isOpen()), false, 'same-match server reopening does not trap player');
    await heroPage.evaluate(() => MatchRating.update({ open: true, matchId: 'next-match', title: 'Next game', myRating: null }, { isHost: false }));
    await heroPage.getByRole('dialog', { name: 'Rate this game', exact: true }).waitFor();
    assert.equal(await heroPage.locator('.match-rating-status').textContent(), 'SELECT ONE SCORE // 1–10');
    await heroPage.getByRole('button', { name: 'RETURN TO MENU', exact: true }).focus();
    await heroPage.keyboard.press('Escape');
    assert.equal(await heroPage.evaluate(() => MatchRating.isOpen()), false, 'Escape dismisses without requiring a rating');
    await heroPage.evaluate(() => {
      MatchRating.update({ open: true, matchId: 'next-match' }, { isHost: true });
    });
    assert.equal(await heroPage.locator('.match-rating-dismiss').count(), 0, 'GM controls unchanged by player dismissal');
    await heroPage.getByRole('button', { name: 'PROCEED TO RECOUNT', exact: true }).waitFor();
    console.log('PASS GM-only rating roster: names/scores, three WAITING, live vote updates, no public leak, GM reconnect, browser DOM');
    console.log('PASS player ratings dismissal: mobile return-to-menu, vote preserved, other players continue, updates/reload stay dismissed, next match opens, Escape skips, GM unaffected');
  } finally {
    await browser?.close();
    sockets.forEach(ws => { try { ws.terminate(); } catch {} });
    await s.stop();
  }
})().catch(err => { console.error(err.stack||err); process.exitCode=1; });
