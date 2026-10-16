/**
 * `asb build`: build images, and the asb images they are built from.
 */
import {checkUser, writableRoots} from '../sandbox/check.js';
import {buildArgs} from '../docker/args.js';
import {buildOrder} from '../config/images.js';
import {displayPath} from '../config/paths.js';
import {EXIT} from '../errors.js';
import {imageNames} from './common.js';
import path from 'node:path';
import {printable} from '../util/format.js';
import {realpathOrSelf} from '../util/fs.js';

export default {
  name: 'build',
  helpGroup: 'Sandbox and config commands:',
  summary: 'Build images',
  description: 'Build images with your user name, uid, and gid as build ' +
    'args (USERNAME, UID, GID). Images a Dockerfile is built FROM (e.g. ' +
    '`FROM asb-default`) are built first; Docker\'s cache makes unchanged ' +
    'ones fast. With no names, build the current sandbox\'s image, or ' +
    '"default" outside a sandbox.',
  arguments: [{name: '[images...]', description: 'image names',
    complete: 'images'}],
  options: [
    {flags: '--no-cache', description: 'build without the layer cache'},
    {flags: '--pull',
      description: 'pull newer versions of non-asb base images (e.g. ' +
        'ubuntu)'},
    {flags: '--no-bases',
      description: 'only build the named images, not the asb images they ' +
        'are built from'}
  ],

  async run(context) {
    const {config, args, options, env, notice} = context;
    checkUser(config.settings);
    const names = await imageNames(context, args);
    const order = await buildOrder(names, config.images,
      {bases: options.bases, env});
    const roots = await writableRoots(config);
    for(const {name, baseOf, bases} of order) {
      const image = config.images[name];
      if(baseOf) {
        notice(`building ${image.tag} (the base of ${baseOf})`);
      }
      // e.g. a project's own Dockerfile in a sandbox's workspace: fine, but
      // what gets built (and used by every sandbox on this image) is then
      // up to that sandbox
      const realContext = await realpathOrSelf(image.context);
      const root = roots.find(r => realContext === r.path ||
        realContext.startsWith(r.path + path.sep));
      if(root) {
        notice(`image ${name}'s build context ` +
          `${printable(displayPath(image.context, env))} is in sandbox ` +
          `"${root.name}"'s writable mounts; that sandbox can change what ` +
          'this builds');
      }
      // --pull would look for local asb images in a registry and fail;
      // their own base images were pulled when they were built
      const pull = options.pull && bases.length === 0;
      const code = await context.docker.run(buildArgs(image,
        config.settings, {noCache: !options.cache, pull}));
      if(code !== 0) {
        return {exitCode: EXIT.FAILED};
      }
    }
    return {};
  }
};
