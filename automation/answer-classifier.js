'use strict';

const TARGETS = Object.freeze(['A', 'B', 'C', 'D', 'FINAL']);

function explicitTarget(raw) {
  const match = String(raw || '').trim().match(/^(?:([a-dk])\s+([a-z]+(?:['-][a-z]+)*)|([a-z]+(?:['-][a-z]+)*)\s+([a-dk]))$/i);
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
  const explicit = explicitTarget(raw);
  if (explicit) return { kind: 'ANSWER', ...explicit };
  return { kind: 'IGNORE', reason: 'NO_EXACT_GAME_GRAMMAR' };
}

module.exports = { TARGETS, explicitTarget, coordinateIntent, eligibleMessage, classifyMessage };
