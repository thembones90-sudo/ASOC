'use strict';

const { normalizeAnswer } = require('./answer-normalize');

const TARGETS = Object.freeze(['A', 'B', 'C', 'D', 'FINAL']);

function withoutEmoticons(raw) {
  // Keep the D in a column marker, but not in a trailing smile such as :D.
  return String(raw || '').replace(/[;:=8][\-'^]?[)(/\\DdPpOo]+(?=\s|$|[!?.,]|\p{Extended_Pictographic})/gu, ' ')
    .replace(/(^|\s)[xX][dD]+(?=\s|$|[!?.,])/g, '$1 ');
}

function broadTarget(raw, solutions = {}) {
  const words = normalizeAnswer(withoutEmoticons(raw)).split(' ').filter(Boolean);
  const markers = words.flatMap((word, index) => /^[abcdk]$/.test(word) || word === 'final'
    ? [{ target: word === 'k' || word === 'final' ? 'FINAL' : word.toUpperCase(), index }] : []);
  if (!markers.length) return null;
  const matches = [];
  for (const [target, solution] of Object.entries(solutions)) {
    if (!TARGETS.includes(target)) continue;
    const phrase = normalizeAnswer(solution).split(' ').filter(Boolean);
    if (!phrase.length) continue;
    for (let start = 0; start <= words.length - phrase.length; start++) {
      if (!phrase.every((word, offset) => word === words[start + offset])) continue;
      // A letter inside the answer itself cannot also act as its column.
      const outside = markers.filter(marker => marker.index < start || marker.index >= start + phrase.length);
      if (!outside.length) continue;
      matches.push({ target, answer: String(solution), outside });
    }
  }
  if (!matches.length) return null;
  const namedMatches = matches.filter(match => match.outside.some(marker => marker.target === match.target));
  const candidates = namedMatches.length ? namedMatches : matches;
  const markerTargets = new Set(candidates.flatMap(match => match.outside.map(marker => marker.target)));
  const candidateTargets = [...new Set(namedMatches.map(match => match.target))];
  if (markerTargets.size > 1 || candidateTargets.length > 1) {
    return { target: candidateTargets[0] || [...markerTargets][0], answer: candidates[0].answer,
      ambiguous: true, candidateTargets: [...markerTargets] };
  }
  return { target: [...markerTargets][0], answer: candidates[0].answer };
}

function explicitTarget(raw) {
  // Players naturally phrase guesses as questions ("property A?"). Terminal
  // sentence punctuation is presentation, not part of the one-word answer.
  const text = String(raw || '').trim().replace(/[?!.,;:]+$/u, '').trim();
  const match = text.match(/^(?:([a-dk])\s+([a-z]+(?:['-][a-z]+)*)|([a-z]+(?:['-][a-z]+)*)\s+([a-dk]))$/i);
  if (!match) return null;
  const marker = (match[1] || match[4]).toUpperCase();
  return { target: marker === 'K' ? 'FINAL' : marker, answer: match[2] || match[3] };
}

function coordinateIntent(raw) {
  const match = String(raw || '').trim().match(/^([a-z])\s*(\d{1,2})$/i);
  if (!match) return null;
  const cell = `${match[1].toUpperCase()}${match[2]}`;
  return { cell, valid: /^[A-D][1-4]$/.test(cell) };
}

function eligibleMessage(message, context = {}) {
  if (!message || typeof message.text !== 'string') return { ok: false, reason: 'NO_TEXT' };
  if (message.deleted === true) return { ok: false, reason: 'DELETED' };
  if (message.source) return { ok: false, reason: 'NON_PLAYER_SOURCE' };
  if (message.verdict !== null && message.verdict !== undefined) return { ok: false, reason: 'ALREADY_JUDGED' };
  if (context.roomMode && String(context.roomMode).toLowerCase() !== 'battle') return { ok: false, reason: 'NOT_BATTLE' };
  if (context.boardId && message.boardId !== context.boardId) return { ok: false, reason: 'STALE_BOARD' };
  const text = message.text.trim();
  if (!text) return { ok: false, reason: 'EMPTY' };
  if (text.startsWith('/')) return { ok: false, reason: 'COMMAND' };
  return { ok: true };
}

function classifyMessage(message, context = {}) {
  const eligibility = eligibleMessage(message, context);
  if (!eligibility.ok) return { kind: 'IGNORE', reason: eligibility.reason };
  const raw = message.text.trim();
  const coordinate = coordinateIntent(raw);
  if (coordinate) return { kind: 'COORDINATE', ...coordinate };
  // Emoji are presentation, including on wrong guesses. Keep apostrophes and
  // hyphens intact so adding an emoji cannot change the answer's boundaries.
  const plain = withoutEmoticons(raw).replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu, ' ');
  const explicit = explicitTarget(plain);
  if (explicit) return { kind: 'ANSWER', ...explicit };
  const broad = broadTarget(raw, context.solutions);
  if (broad) return { kind: 'ANSWER', ...broad };
  const decorated = explicitTarget(normalizeAnswer(plain));
  if (decorated) return { kind: 'ANSWER', ...decorated };
  return { kind: 'IGNORE', reason: 'NO_EXACT_GAME_GRAMMAR' };
}

module.exports = { TARGETS, explicitTarget, coordinateIntent, eligibleMessage, classifyMessage, broadTarget };
