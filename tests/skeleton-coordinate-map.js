'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'skeleton.js'), 'utf8');
const context = { window: {}, document: {}, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/skeleton.js' });

const slots = context.window.Skeleton.slots;
assert.ok(slots, 'Skeleton exposes its canonical slot map');

// Every arm is numbered from the outside edge toward its solution/centre.
assert.ok(slots.A1.x < slots.A2.x && slots.A2.x < slots.A3.x && slots.A3.x < slots.A4.x, 'A runs outer to inner');
assert.ok(slots.B1.x > slots.B2.x && slots.B2.x > slots.B3.x && slots.B3.x > slots.B4.x, 'B runs outer to inner');
assert.ok(slots.C1.x < slots.C2.x && slots.C2.x < slots.C3.x && slots.C3.x < slots.C4.x, 'C runs outer to inner');
assert.ok(slots.D1.x > slots.D2.x && slots.D2.x > slots.D3.x && slots.D3.x > slots.D4.x, 'D runs outer to inner');

console.log('PASS skeleton coordinate map: 1 is outermost and 4 is innermost');
