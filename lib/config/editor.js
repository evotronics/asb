/**
 * Comment preserving config editing.
 *
 * Edits are made to YAML documents in memory. `commit()` validates the
 * resulting config (by loading it, and resolving every sandbox, with the
 * pending contents) before anything is written, and in dry run mode only
 * reports diffs.
 */
import {CONFIG_FILE, configDir, displayPath, SANDBOXES_DIR}
  from './paths.js';
import {parseYaml, stringifyYaml} from './files.js';
import {ConfigError} from '../errors.js';
import {createTwoFilesPatch} from 'diff';
import fs from 'node:fs/promises';
import {loadConfig} from './load.js';
import path from 'node:path';
import {pathExists} from '../util/fs.js';
import {resolveSandbox} from '../sandbox/resolve.js';
import YAML from 'yaml';

export class ConfigEditor {
  /**
   * @param {object} [options] - Options.
   * @param {object} [options.env] - Environment.
   */
  constructor({env = process.env} = {}) {
    this.env = env;
    this.dir = configDir(env);
    // file -> {original: string|null, document: Document|null}
    this.files = new Map();
  }

  get configFile() {
    return path.join(this.dir, CONFIG_FILE);
  }

  sandboxFile(name) {
    return path.join(this.dir, SANDBOXES_DIR, `${name}.yaml`);
  }

  /**
   * Get the config.yaml document, creating the file if needed.
   *
   * @returns {Promise<YAML.Document>} Document.
   */
  async configDocument() {
    const file = this.configFile;
    if(!this.files.has(file) && !await pathExists(file)) {
      return this.create(file, {version: 1});
    }
    return this.document(file);
  }

  /**
   * Get the document for a file, loading it on first use.
   *
   * @param {string} file - Absolute path.
   *
   * @returns {Promise<YAML.Document>} Document.
   */
  async document(file) {
    let entry = this.files.get(file);
    if(!entry) {
      const original = await fs.readFile(file, 'utf8');
      const document = parseYaml(original);
      if(document.errors.length > 0) {
        throw new ConfigError(`Invalid YAML in "${this.display(file)}".`, {
          details: document.errors.map(e => e.message)
        });
      }
      if(!YAML.isMap(document.contents)) {
        document.contents = document.createNode({});
      }
      entry = {original, document};
      this.files.set(file, entry);
    }
    if(entry.text !== undefined) {
      entry.document = parseYaml(entry.text);
      if(!YAML.isMap(entry.document.contents)) {
        entry.document.contents = entry.document.createNode({});
      }
      delete entry.text;
    }
    if(!entry.document) {
      throw new ConfigError(`"${this.display(file)}" is being deleted.`);
    }
    return entry.document;
  }

  /**
   * Create a new file.
   *
   * @param {string} file - Absolute path.
   * @param {object} data - Initial data.
   * @param {object} [options] - Options.
   * @param {string} [options.comment] - Comment at the top of the file.
   *
   * @returns {YAML.Document} The new document.
   */
  create(file, data, {comment} = {}) {
    const document = new YAML.Document(data);
    if(comment) {
      document.commentBefore = comment;
    }
    this.files.set(file, {original: null, document});
    return document;
  }

  /**
   * Create a new file from text, for files that are only comments.
   *
   * @param {string} file - Absolute path.
   * @param {string} text - Content.
   */
  createText(file, text) {
    this.files.set(file, {original: null, document: null, text});
  }

  /**
   * Delete a file.
   *
   * @param {string} file - Absolute path.
   */
  async remove(file) {
    const original = this.files.get(file)?.original ??
      await fs.readFile(file, 'utf8');
    this.files.set(file, {original, document: null});
  }

  /**
   * Pending changes.
   *
   * @returns {Array<{file: string, before: string|null, after: string|null}>}
   *   Changed files; null content means the file does not exist.
   */
  changes() {
    const changes = [];
    for(const [file, {original, document, text}] of this.files) {
      const after = text ?? (document ? stringifyYaml(document) : null);
      if(after !== original) {
        changes.push({file, before: original, after});
      }
    }
    return changes.sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * Validate and (unless dry run) write pending changes.
   *
   * @param {object} [options] - Options.
   * @param {boolean} [options.dryRun] - Do not write.
   *
   * @returns {Promise<{changes: object[], config: object}>} Changes with
   *   `path` (for display), `action`, and `diff`, and the resulting config.
   */
  async commit({dryRun = false} = {}) {
    const changes = this.changes();
    const overrides = new Map(changes.map(c => [c.file, c.after]));
    // throws ConfigError if the result would be invalid
    const config = await loadConfig({env: this.env, overrides});
    // a sandbox that was already broken, and isn't being changed, doesn't
    // block other edits
    const broken = await this.brokenSandboxes();
    for(const entry of config.sandboxes) {
      try {
        resolveSandbox(config, entry);
      } catch(e) {
        if(!(e instanceof ConfigError) || !broken.has(entry.name) ||
          overrides.has(entry.file)) {
          throw e;
        }
      }
    }
    if(!dryRun) {
      for(const {file, after} of changes) {
        if(after === null) {
          await fs.rm(file);
        } else {
          await fs.mkdir(path.dirname(file), {recursive: true});
          await fs.writeFile(file, after);
        }
      }
    }
    return {config, changes: changes.map(change => {
      const display = this.display(change.file);
      return {
        path: display,
        action: change.before === null ? 'create' :
          change.after === null ? 'delete' : 'update',
        diff: createTwoFilesPatch(
          change.before === null ? '/dev/null' : `a/${display}`,
          change.after === null ? '/dev/null' : `b/${display}`,
          change.before ?? '', change.after ?? '', '', '', {context: 2})
          .replace(/^=+\n/, '')
      };
    })};
  }

  /**
   * Names of the sandboxes whose current settings don't resolve.
   *
   * @returns {Promise<Set<string>>} Names.
   */
  async brokenSandboxes() {
    const broken = new Set();
    let config;
    try {
      config = await loadConfig({env: this.env});
    } catch {
      return broken;
    }
    for(const entry of config.sandboxes) {
      try {
        resolveSandbox(config, entry);
      } catch(e) {
        if(!(e instanceof ConfigError)) {
          throw e;
        }
        broken.add(entry.name);
      }
    }
    return broken;
  }

  display(file) {
    return displayPath(file, this.env);
  }
}

/**
 * Format edit results: messages, then per-file lines with diffs in dry run
 * or verbose mode.
 *
 * @param {object} data - Edit data.
 * @param {string[]} data.messages - Messages describing the edits.
 * @param {object[]} data.changes - File changes from `ConfigEditor`.
 * @param {object} context - Command context.
 * @param {object} context.c - Colors.
 * @param {boolean} context.dryRun - Dry run.
 * @param {boolean} context.verbose - Verbose.
 *
 * @returns {string} Text.
 */
export function editText({messages, changes}, {c, dryRun, verbose}) {
  const lines = [...messages];
  if(changes.length === 0) {
    lines.push(c.dim('No config changes.'));
    return lines.join('\n');
  }
  for(const change of changes) {
    const verb = {
      create: dryRun ? 'would create' : 'created',
      update: dryRun ? 'would update' : 'updated',
      delete: dryRun ? 'would delete' : 'deleted'
    }[change.action];
    lines.push(`${dryRun ? c.cyan(verb) : verb} ${change.path}`);
    if(dryRun || verbose) {
      lines.push(colorDiff(change.diff, c));
    }
  }
  return lines.join('\n');
}

function colorDiff(diff, c) {
  return diff.replace(/\n$/, '').split('\n').map(line => {
    if(line.startsWith('+++') || line.startsWith('---')) {
      return c.bold(line);
    }
    if(line.startsWith('@@')) {
      return c.cyan(line);
    }
    if(line.startsWith('+')) {
      return c.green(line);
    }
    if(line.startsWith('-')) {
      return c.red(line);
    }
    return line;
  }).join('\n');
}
