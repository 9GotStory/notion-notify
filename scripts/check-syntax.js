'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === 'node_modules') return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function check(source, filename) {
  try {
    new vm.Script(source, { filename });
  } catch (err) {
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

walk(path.join(root, 'apps'))
  .filter(file => file.endsWith('.gs'))
  .forEach(file => check(fs.readFileSync(file, 'utf8'), path.relative(root, file)));

['gateway', 'scripts', 'web'].flatMap(dir => walk(path.join(root, dir)))
  .filter(file => file.endsWith('.js'))
  .forEach(file => check(fs.readFileSync(file, 'utf8'), path.relative(root, file)));

walk(path.join(root, 'web'))
  .filter(file => file.endsWith('.html'))
  .forEach(file => {
    const html = fs.readFileSync(file, 'utf8');
    const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let match;
    let index = 0;
    while ((match = scriptPattern.exec(html))) {
      if (match[1].trim()) check(match[1], path.relative(root, file) + '#script-' + (++index));
    }
  });

if (!process.exitCode) console.log('Syntax check passed');
