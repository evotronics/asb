/**
 * Text formatting helpers.
 */
import picocolors from 'picocolors';
import {stripVTControlCharacters} from 'node:util';

/**
 * Create color functions.
 *
 * @param {boolean} enabled - Enable color.
 *
 * @returns {object} Picocolors style functions.
 */
export function createColors(enabled) {
  return picocolors.createColors(enabled);
}

/**
 * Decide whether to use color.
 *
 * @param {object} options - Options.
 * @param {boolean} [options.color] - Explicit --color / --no-color.
 * @param {object} options.stream - Output stream.
 * @param {object} options.env - Environment.
 *
 * @returns {boolean} True to use color.
 */
export function shouldUseColor({color, stream, env}) {
  if(color !== undefined) {
    return color;
  }
  if('NO_COLOR' in env && env.NO_COLOR !== '') {
    return false;
  }
  if('FORCE_COLOR' in env) {
    return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  }
  return Boolean(stream.isTTY) && env.TERM !== 'dumb';
}

/**
 * Format rows as aligned columns.
 *
 * @param {string[][]} rows - Rows of cells (may contain ANSI escapes).
 * @param {object} [options] - Options.
 * @param {string} [options.gap] - Column separator.
 *
 * @returns {string} Table text (no trailing newline).
 */
export function formatTable(rows, {gap = '  '} = {}) {
  const width = value => stripVTControlCharacters(value).length;
  const widths = [];
  for(const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell));
    });
  }
  return rows.map(row => row.map((cell, i) => i === row.length - 1 ?
    cell : cell + ' '.repeat(widths[i] - width(cell))).join(gap).trimEnd())
    .join('\n');
}

/**
 * Format a command for display, quoting arguments for a POSIX shell when
 * needed, so it can be copied and pasted.
 *
 * @param {string} cmd - Command.
 * @param {string[]} args - Arguments.
 *
 * @returns {string} Display string.
 */
export function formatCommand(cmd, args = []) {
  return [cmd, ...args].map(quote).join(' ');
}

function quote(value) {
  if(value === '') {
    return '\'\'';
  }
  if(/^[\w@%+=:,./-]+$/.test(value)) {
    return value;
  }
  // control characters (e.g. from file names in a workspace) could change
  // the terminal; write them as escapes in bash/zsh $'...' quoting
  // eslint-disable-next-line no-control-regex
  if(/[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return `$'${value.replace(/[\\']/g, '\\$&')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, c => {
        const code = c.charCodeAt(0).toString(16).padStart(2, '0');
        return c.charCodeAt(0) < 0x80 ? `\\x${code}` : `\\u00${code}`;
      })}'`;
  }
  return `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

/**
 * Make text from outside asb (docker output, file names) safe to print by
 * escaping control characters, which could otherwise inject terminal
 * escape sequences.
 *
 * @param {string} value - Text.
 *
 * @returns {string} Text with control characters shown as `\xNN`.
 */
export function printable(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g,
    c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
