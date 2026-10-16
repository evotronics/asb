import {describe, expect, it} from 'vitest';
import {formatCommand, printable} from '../../lib/util/format.js';

describe('formatCommand', () => {
  it('quotes arguments for a shell', () => {
    expect(formatCommand('docker', ['run', '', 'a b', 'it\'s', 'x=1']))
      .toBe('docker run \'\' \'a b\' \'it\'\\\'\'s\' x=1');
  });

  it('escapes control characters', () => {
    expect(formatCommand('docker', ['a\u001b[31mb', 'c\'d\n']))
      .toBe('docker $\'a\\x1b[31mb\' $\'c\\\'d\\x0a\'');
  });
});

describe('printable', () => {
  it('escapes control characters', () => {
    expect(printable('a\u001b]0;x\u0007b')).toBe('a\\x1b]0;x\\x07b');
  });
});
