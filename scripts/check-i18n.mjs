#!/usr/bin/env node
/**
 * i18n guard (CI). Fails when user-facing English text is written directly in
 * the apps instead of going through t('key'), or when a literal t('key') is
 * missing from the English source dictionary.
 *
 * Uses the TypeScript compiler AST, so multi-line JSX text is caught too.
 * Flags:
 *   1. JSX text nodes containing words.
 *   2. String values of user-facing props (label, title, placeholder, hint, alt,
 *      aria-label, accessibilityLabel, accessibilityHint, subtitle, body, caption).
 *   3. Sentence-like string literals anywhere else (e.g. toast / setMessage text),
 *      except inside t()/translation calls, imports, className-like props.
 * Escape hatch for a deliberate literal: put `i18n-ignore` in a comment on the line
 * (or wrap a data block in `i18n-ignore-start` / `i18n-ignore-end`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/mobile/src', 'apps/demo/src'];
const USER_PROPS = new Set(['label', 'title', 'placeholder', 'hint', 'alt', 'aria-label', 'accessibilityLabel', 'accessibilityHint', 'subtitle', 'body', 'caption', 'labelText']);
const NON_TEXT_PROPS = new Set(['className', 'style', 'href', 'type', 'id', 'htmlFor', 'name', 'key', 'role', 'inputMode', 'autoComplete', 'lang', 'rel', 'target', 'accept', 'capture', 'src', 'method', 'action', 'keyboardType', 'edges', 'tone', 'kind', 'precedence', 'value', 'defaultValue', 'aria-current', 'aria-pressed']);
const TRANSLATE_CALLS = new Set(['t', 'tr', 'field', 'useT', 'errorMessage', 'fieldLabel', 'translator']);
const ALLOW = /^(AIEC|mm|cm|m|OK|PDF|GPS|OTP|UTR|IST|INR|₹|—|·|→|←|\+|\*|×|✓|✗|⚠|…|DEMO)$/;

function walkDir(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const hasWords = (s) => /[A-Za-z]{2,}/.test(s);
const wordsOnlyAllowed = (s) => s.split(/[\s,.:;!?()/'"-]+/).filter(Boolean).every((w) => ALLOW.test(w) || !/[A-Za-z]/.test(w));
const sentenceLike = (s) => /^[A-Z][a-z]+[ ,.!?—:]/.test(s.trim()) || /\b[a-z]{3,} [a-z]{3,} [a-z]{3,}\b/.test(s);

function dictionaryKeys() {
  const file = join(root, 'packages/domain/src/messages/en.ts');
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const keys = new Set();
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isIdentifier(n.name))) keys.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return keys;
}

const keys = dictionaryKeys();
const problems = [];
const usedKeys = new Set();

for (const dir of SCAN) {
  for (const file of walkDir(join(root, dir))) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // Lines between `i18n-ignore-start` and `i18n-ignore-end` comments hold data (e.g. fictional seed names).
    const ignoredLines = new Set();
    for (let i = 0, on = false; i < lines.length; i++) {
      if (/i18n-ignore-start/.test(lines[i])) on = true;
      if (on) ignoredLines.add(i);
      if (/i18n-ignore-end/.test(lines[i])) on = false;
    }
    const report = (node, msg) => {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart());
      if (ignoredLines.has(line)) return;
      if (/i18n-ignore(?!-)/.test(lines[line] ?? '') || /i18n-ignore(?!-)/.test(lines[line - 1] ?? '')) return;
      problems.push(`${relative(root, file)}:${line + 1}  ${msg}`);
    };
    const inside = (node, pred) => {
      for (let p = node.parent; p; p = p.parent) if (pred(p)) return p;
      return null;
    };
    const visit = (n) => {
      // 1. JSX text
      if (ts.isJsxText(n)) {
        const parentEl = n.parent && ts.isJsxElement(n.parent) ? n.parent.openingElement.tagName.getText() : '';
        if (parentEl === 'code') return; // code identifiers, e.g. environment variable names
        const s = n.text.replace(/\s+/g, ' ').trim();
        if (s && hasWords(s) && !wordsOnlyAllowed(s)) report(n, `JSX text: "${s.slice(0, 60)}"`);
      }
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        const s = n.text;
        const call = inside(n, (p) => ts.isCallExpression(p));
        const directCallArg = n.parent && ts.isCallExpression(n.parent) ? n.parent : null;
        const calleeName = directCallArg ? (ts.isIdentifier(directCallArg.expression) ? directCallArg.expression.text : ts.isPropertyAccessExpression(directCallArg.expression) ? directCallArg.expression.name.text : '') : '';
        if (directCallArg && TRANSLATE_CALLS.has(calleeName) && directCallArg.arguments[0] === n) {
          usedKeys.add(s);
          if (calleeName === 't' || calleeName === 'tr') {
            if (!/[{}$]/.test(s) && !keys.has(s)) report(n, `missing dictionary key: '${s}'`);
          }
          return;
        }
        if (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent) || (n.parent && ts.isExternalModuleReference(n.parent))) return;
        // Compared values are data, not text (status === 'qualified').
        if (n.parent && (ts.isCaseClause(n.parent) || (ts.isBinaryExpression(n.parent) && ['===', '!==', '==', '!='].includes(n.parent.operatorToken.getText())))) return;
        const attr = inside(n, (p) => ts.isJsxAttribute(p));
        const attrName = attr ? attr.name.getText() : null;
        if (attrName && USER_PROPS.has(attrName)) {
          // A literal passed to a function inside the prop (f('city'), can(ctx, 'x')) is a key/argument, not text.
          const callInAttr = call && attr && call.pos >= attr.pos && call.end <= attr.end;
          if (callInAttr) return;
          if (hasWords(s) && !wordsOnlyAllowed(s)) report(n, `prop ${attrName}="${s.slice(0, 60)}"`);
          return;
        }
        if (attrName && NON_TEXT_PROPS.has(attrName)) return;
        if (ts.isPropertyAssignment(n.parent) && n.parent.name === n) return; // object key
        if (ts.isLiteralTypeNode(n.parent)) return; // type
        if (n.parent && (ts.isCaseClause(n.parent) || ts.isBinaryExpression(n.parent) && ['===', '!==', '==', '!='].includes(n.parent.operatorToken.getText()))) return;
        if (call && ts.isCallExpression(call) && /^(require|import|querySelector|getElementById|addEventListener|setItem|getItem|removeItem|rpc|from|select|eq|in|lt|is|order|or|on|getByText|startsWith|replace|split|includes|match|test)$/.test(call.expression.getText().split('.').pop() ?? '')) return;
        if (hasWords(s) && sentenceLike(s) && !wordsOnlyAllowed(s) && !/^[a-z0-9_.:-]+$/.test(s) && !/[{}]|https?:|\/\/|^\//.test(s)) report(n, `string literal: '${s.slice(0, 60)}'`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
}

if (problems.length) {
  console.error(`i18n check failed: ${problems.length} problem(s)\n` + problems.join('\n'));
  process.exit(1);
}
console.log(`i18n check passed (${keys.size} dictionary keys, ${usedKeys.size} literal keys used).`);
