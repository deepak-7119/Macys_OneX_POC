import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesheet = await readFile(
  new URL('../platform/bobbin/shell/styles/styles.css', import.meta.url),
  'utf8',
);
const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
const logo = await readFile(new URL('../public/brand/macys-logo.svg', import.meta.url), 'utf8');

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/([\w-]+)\s*:\s*([^;{}]+)\s*;?/g)].map((match) => [
      match[1],
      match[2].trim().toLowerCase(),
    ]),
  );
}

const tokens = new Map(
  [...css.matchAll(/:root\s*\{([^{}]*)\}/g)].flatMap((match) => [...declarations(match[1])]),
);

// This intentionally checks simple base rules, not browser cascade/layout. Browser
// smoke checks cover the rendered theme; source checks guard its shared palette.
function baseRule(selector: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').some((candidate) => candidate.trim() === selector)) {
      for (const [key, value] of declarations(match[2])) result.set(key, value);
    }
  }
  return result;
}

function color(value: string | undefined): string {
  assert.ok(value, 'a color declaration is required');
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  return reference ? color(tokens.get(reference[1])) : value;
}

function luminance(hex: string): number {
  assert.match(hex, /^#(?:[\da-f]{3}|[\da-f]{6})$/i, 'contrast checks need opaque hex colors');
  const expanded =
    hex.length === 4 ? [...hex.slice(1)].map((digit) => digit + digit).join('') : hex.slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test('shared theme preserves the Macy’s black, white and red palette with local sans-serif typography', () => {
  assert.equal(tokens.get('--brand-red'), '#e11a2b');
  assert.equal(tokens.get('--red'), '#c8102e');
  assert.equal(tokens.get('--ink'), '#111');
  assert.equal(tokens.get('--muted'), '#555');
  assert.equal(tokens.get('--surface'), '#fff');
  assert.equal(tokens.get('background'), '#fff');
  assert.equal(tokens.get('font-family'), "'helvetica neue', helvetica, arial, sans-serif");
});

test('shared text, primary actions and input boundaries retain readable contrast on white', () => {
  const white = color(tokens.get('--surface'));
  assert.ok(
    contrast(color(tokens.get('--ink')), white) >= 7,
    'primary text has at least 7:1 contrast',
  );
  for (const token of ['--muted', '--secondary-text', '--placeholder-text', '--red']) {
    assert.ok(
      contrast(color(tokens.get(token)), white) >= 4.5,
      `${token} has at least 4.5:1 contrast`,
    );
  }
  const primary = baseRule('.thread-button--primary');
  assert.ok(contrast(color(primary.get('color')), color(primary.get('background'))) >= 7);
  for (const selector of [
    '.thread-field input',
    '.thread-field select',
    '.document-filter select',
    '.workspace-footer select',
  ]) {
    assert.ok(
      contrast(color(baseRule(selector).get('border-color')), white) >= 3,
      `${selector} boundary has at least 3:1 contrast`,
    );
  }
});

test('vendored Macy’s logo is a static self-contained SVG with the original aspect ratio and brand colors', () => {
  assert.match(logo, /<svg\b[^>]*\bviewBox=["']0 0 141 40["']/);
  assert.match(logo, /\bfill=["']#E11A2B["']/i);
  assert.match(logo, /\bfill=["']#000["']/i);
  assert.doesNotMatch(logo, /<!DOCTYPE|<!ENTITY|<\?|\bon[\w:-]+\s*=|javascript:/i);

  const allowedTags = new Set(['svg', 'g', 'path', 'defs', 'clippath']);
  const tags = [...logo.matchAll(/<\/?\s*([\w:-]+)\b/g)].map((match) => match[1].toLowerCase());
  assert.ok(tags.length > 0);
  assert.ok(
    tags.every((tag) => allowedTags.has(tag)),
    'logo must not introduce scripts, embedded documents, images or animation',
  );
  for (const match of logo.matchAll(/(?:\b|:)href\s*=\s*["']([^"']*)["']/gi)) {
    assert.match(match[1], /^#[\w-]+$/, 'SVG references must stay within this asset');
  }
  for (const match of logo.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/gi)) {
    assert.match(match[1], /^#[\w-]+$/, 'SVG paint and clip references must be local');
  }
});

test('theme stylesheet does not add remote font or image dependencies', () => {
  assert.doesNotMatch(css, /@import\b/i, 'styles must be bundled locally');
  for (const match of css.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/gi)) {
    assert.doesNotMatch(match[1], /^(?:[a-z][\w+.-]*:|\/\/)/i, 'theme assets must use local URLs');
  }
});
