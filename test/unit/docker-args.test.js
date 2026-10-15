import {bindMount, buildArgs, execArgs, runArgs}
  from '../../lib/docker/args.js';
import {describe, expect, it} from 'vitest';
import {loadConfig} from '../../lib/config/load.js';
import path from 'node:path';
import {resolveSandbox} from '../../lib/sandbox/resolve.js';

const env = {
  HOME: '/h',
  ASB_CONFIG_DIR: '/nonexistent/asb-config',
  XDG_DATA_HOME: '/h/.local/share'
};

async function sandbox(data, name = 'widget') {
  const config = await loadConfig({env});
  config.settings.uid = 1000;
  config.settings.gid = 1001;
  return resolveSandbox(config, {name, file: `/c/${name}.yaml`, data});
}

describe('runArgs', () => {
  it('builds a hardened detached container', async () => {
    const s = await sandbox({});
    expect(runArgs(s)).toEqual([
      'run', '-itd', '--rm', '--name', 'asb-widget',
      '--label', 'asb.sandbox=widget', '--hostname', 'widget',
      '--cpus', '4', '--memory', '16g', '--pids-limit', '2048',
      '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
      '--user', '1000:1001',
      '--network', 'bridge',
      '--tmpfs', '/tmp:rw,noexec,nosuid',
      '--mount',
      'type=bind,source=/h/.local/share/asb/homes/widget,target=/home/agent',
      '--workdir', '/home/agent',
      '--env', 'HOME=/home/agent',
      'asb-default'
    ]);
  });

  it('adds workspace, protected paths, mounts, ports, and options',
    async () => {
      const s = await sandbox({
        home: '/homes/w',
        workspace: '~/ws',
        mounts: ['/a,b:/x:ro', {source: '/data', target: 'data'}],
        ports: [9323, '8080:80'],
        network: 'none',
        env: {A: 1},
        readonly: true,
        tmpExec: true,
        runArgs: ['--add-host', 'host.docker.internal:host-gateway']
      });
      const args = runArgs(s, {
        detach: false, tty: false, protect: ['.mpm', 'r/.git/config'],
        workdir: '/home/agent/workspace/r', command: ['npm', 'test']
      });
      expect(args.slice(0, 3)).toEqual(['run', '-i', '--rm']);
      expect(args).not.toContain('--name');
      expect(args).toContain('--read-only');
      expect(args).toContain('/tmp:rw');
      const mounts = args.flatMap((a, i) =>
        args[i - 1] === '--mount' ? [a] : []);
      expect(mounts).toEqual([
        'type=bind,source=/homes/w,target=/home/agent',
        'type=bind,source=/h/ws,target=/home/agent/workspace',
        'type=bind,source=/h/ws/.mpm,target=/home/agent/workspace/.mpm,' +
          'readonly',
        'type=bind,source=/h/ws/r/.git/config,' +
          'target=/home/agent/workspace/r/.git/config,readonly',
        'type=bind,"source=/a,b",target=/x,readonly',
        'type=bind,source=/data,target=/home/agent/data'
      ]);
      expect(args.join(' ')).toContain(
        '--workdir /home/agent/workspace/r --publish 9323:9323 ' +
        '--publish 8080:80 --env HOME=/home/agent --env A=1 ' +
        '--add-host host.docker.internal:host-gateway asb-default npm test');
      expect(args.join(' ')).toContain('--network none');
    });
});

describe('execArgs', () => {
  it('runs the shell or a command', async () => {
    const s = await sandbox({workspace: '/ws'});
    expect(execArgs(s)).toEqual(['exec', '-it', '--workdir',
      '/home/agent/workspace', 'asb-widget', '/bin/bash']);
    expect(execArgs(s, {tty: false, workdir: '/tmp', command: ['ls', '-l']}))
      .toEqual(['exec', '-i', '--workdir', '/tmp', 'asb-widget', 'ls', '-l']);
  });
});

describe('buildArgs', () => {
  it('passes the user and image args', async () => {
    const config = await loadConfig({env});
    const image = {
      ...config.images.default,
      args: {NODE: 24}
    };
    const args = buildArgs(image, {user: 'agent', uid: 1000, gid: 1001},
      {noCache: true});
    expect(args).toEqual([
      'build',
      '--build-arg', 'USERNAME=agent',
      '--build-arg', 'UID=1000',
      '--build-arg', 'GID=1001',
      '--build-arg', 'NODE=24',
      '--no-cache',
      '--tag', 'asb-default',
      '--file', path.join(image.context, 'Dockerfile'),
      image.context
    ]);
  });
});

describe('bindMount', () => {
  it('quotes fields with commas and quotes', () => {
    expect(bindMount('/a"b', '/c')).toBe(
      'type=bind,"source=/a""b",target=/c');
  });
});
