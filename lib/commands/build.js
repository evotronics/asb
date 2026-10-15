/**
 * `asb build`: build images.
 */
import {ConfigError, EXIT, UsageError} from '../errors.js';
import {buildArgs} from '../docker/args.js';

export default {
  name: 'build',
  helpGroup: 'Sandbox and config commands:',
  summary: 'Build images',
  description: 'Build images with your user name, uid, and gid as build ' +
    'args (USERNAME, UID, GID). With no names, build the current ' +
    'sandbox\'s image, or "default" outside a sandbox.',
  arguments: [{name: '[images...]', description: 'image names'}],
  options: [
    {flags: '--no-cache', description: 'build without the layer cache'},
    {flags: '--pull', description: 'pull newer base images'}
  ],

  async run(context) {
    const {config, args, options} = context;
    let names = args;
    if(names.length === 0) {
      try {
        names = [(await context.sandbox()).image.name];
      } catch(e) {
        // no current sandbox; but a bad -s or ASB_SANDBOX is an error
        if(!(e instanceof UsageError) || context.globals.sandbox ||
          context.env.ASB_SANDBOX) {
          throw e;
        }
        names = ['default'];
      }
    }
    for(const name of names) {
      const image = config.images[name];
      if(!image) {
        throw new ConfigError(`Unknown image "${name}".`, {
          details: [`Images: ${Object.keys(config.images).join(', ')}`]
        });
      }
    }
    for(const name of names) {
      const code = await context.docker.run(buildArgs(config.images[name],
        config.settings, {noCache: !options.cache, pull: options.pull}));
      if(code !== 0) {
        return {exitCode: EXIT.FAILED};
      }
    }
    return {};
  }
};
