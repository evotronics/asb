/**
 * YAML reading and writing.
 */
import {ConfigError} from '../errors.js';
import fs from 'node:fs/promises';
import YAML from 'yaml';

/**
 * Read and parse a YAML file.
 *
 * @param {string} file - File path.
 * @param {object} [options] - Options.
 * @param {string} [options.displayPath] - Path to use in error messages.
 * @param {string} [options.text] - Use this content instead of reading the
 *   file.
 *
 * @returns {Promise<{data: *, document: YAML.Document, text: string}>}
 *   Parsed data (null for an empty file), the comment preserving document,
 *   and the source text.
 */
export async function readYamlFile(file, {displayPath = file, text} = {}) {
  if(text === undefined) {
    try {
      text = await fs.readFile(file, 'utf8');
    } catch(e) {
      throw new ConfigError(`Unable to read "${displayPath}": ${e.message}`,
        {cause: e});
    }
  }
  const document = parseYaml(text);
  if(document.errors.length > 0) {
    throw new ConfigError(`Invalid YAML in "${displayPath}".`, {
      details: document.errors.map(e => e.message)
    });
  }
  return {data: document.toJS(), document, text};
}

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
