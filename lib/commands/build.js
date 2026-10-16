/**
 * `asb build`: build images, and the asb images they are built from.
 */
import {EXIT, UsageError} from '../errors.js';
import {buildArgs} from '../docker/args.js';
import {buildOrder} from '../config/images.js';

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
    {flags: '--pull', description: 'pull newer base images'},
    {flags: '--no-bases',
      description: 'only build the named images, not the asb images they ' +
        'are built from'}
  ],

  async run(context) {
    const {config, args, options, env, notice} = context;
    let names = args;
    if(names.length === 0) {
      try {
        names = [(await context.sandbox()).image.name];
      } catch(e) {
        // no current sandbox; but a bad -s or ASB_SANDBOX is an error
        if(!(e instanceof UsageError) || context.globals.sandbox ||
          env.ASB_SANDBOX) {
          throw e;
        }
        names = ['default'];
      }
    }
    const order = await buildOrder(names, config.images,
      {bases: options.bases, env});
    for(const {name, baseOf} of order) {
      const image = config.images[name];
      if(baseOf) {
        notice(`building ${image.tag} (the base of ${baseOf})`);
      }
      const code = await context.docker.run(buildArgs(image,
        config.settings, {noCache: !options.cache, pull: options.pull}));
      if(code !== 0) {
        return {exitCode: EXIT.FAILED};
      }
    }
    return {};
  }
};
