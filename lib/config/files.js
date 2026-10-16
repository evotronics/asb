/**
 * YAML reading and writing.
 */
import {ConfigError} from '../errors.js';
import {displayPath} from './paths.js';
import fs from 'node:fs/promises';
import {pathExists} from '../util/fs.js';
import {validateConfig} from './schema.js';
import YAML from 'yaml';

/**
 * Parse YAML text into a comment preserving document.
 *
 * @param {string} text - YAML text.
 *
 * @returns {YAML.Document} Document (check `errors`).
 */
export function parseYaml(text) {
  return YAML.parseDocument(text, {prettyErrors: true});
}

/**
 * Serialize a document, keeping the style used by asb generated files.
 *
 * @param {YAML.Document} document - Document.
 *
 * @returns {string} YAML text.
 */
export function stringifyYaml(document) {
  return document.toString({lineWidth: 0, flowCollectionPadding: false});
}

/**
 * Read and validate a config file.
 *
 * @param {string} file - Absolute path.
 * @param {object} options - Options.
 * @param {'config'|'sandbox'|'image'} options.kind - Schema to validate
 *   with.
 * @param {object} options.env - Environment (for display paths).
 * @param {Map<string, string|null>} [options.overrides] - Pending file
 *   contents by absolute path; null means deleted.
 *
 * @returns {Promise<object|undefined>} Data (an empty file is `{}`), or
 *   undefined if the file does not exist.
 */
export async function readConfigFile(file, {
  kind, env, overrides = new Map()
}) {
  const override = overrides.get(file);
  if(override === null ||
    (override === undefined && !await pathExists(file))) {
    return undefined;
  }
  const shown = displayPath(file, env);
  let text = override;
  if(text === undefined) {
    try {
      text = await fs.readFile(file, 'utf8');
    } catch(e) {
      throw new ConfigError(`Unable to read "${shown}": ${e.message}`,
        {cause: e});
    }
  }
  const document = parseYaml(text);
  if(document.errors.length > 0) {
    throw new ConfigError(`Invalid YAML in "${shown}".`, {
      details: document.errors.map(e => e.message)
    });
  }
  const value = document.toJS() ?? {};
  const errors = validateConfig(kind, value);
  if(errors.length > 0) {
    throw new ConfigError(`Invalid "${shown}".`, {details: errors});
  }
  return value;
}
