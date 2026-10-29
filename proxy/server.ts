// Entry point of the personal proxy (PRX-01): `node server.ts [--config <path>] | --generate-token`.
//
// Runs with Node 24 type stripping, no build step and no dependencies. See proxy/README.md.
import { pathToFileURL } from 'node:url';
import { createProxyServer, type ProxyDeps } from './app.ts';
import { generateToken } from './auth.ts';
import { ConfigError, defaultConfigPath, loadConfig } from './config.ts';
import { createLogger, errorCode, logConfigProblem, printCliOutput } from './log.ts';

const USAGE = [
  'Usage:',
  '  node server.ts [--config <path>]   start the proxy',
  '  node server.ts --generate-token    print a new random token and exit',
  '',
  `Default config file: ${defaultConfigPath()}`,
].join('\n');

export type CliArgs =
  | { kind: 'generate-token' }
  | { kind: 'help' }
  | { kind: 'run'; configPath: string }
  | { kind: 'invalid' };

export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 1 && argv[0] === '--generate-token') return { kind: 'generate-token' };
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' };
  if (argv.length === 0) return { kind: 'run', configPath: defaultConfigPath() };
  if (argv.length === 2 && argv[0] === '--config' && argv[1] !== undefined && argv[1] !== '') {
    return { kind: 'run', configPath: argv[1] };
  }
  return { kind: 'invalid' };
}

export interface Running {
  close(): Promise<void>;
  port: number;
}

/** Runs the CLI. Resolves to an exit code, or to the running server for `run`. */
export async function main(
  argv: readonly string[],
  deps: ProxyDeps = {},
): Promise<number | Running> {
  const args = parseArgs(argv);
  if (args.kind === 'generate-token') {
    printCliOutput(generateToken());
    return 0;
  }
  if (args.kind === 'help') {
    printCliOutput(USAGE);
    return 0;
  }
  if (args.kind === 'invalid') {
    logConfigProblem('invalid arguments');
    printCliOutput(USAGE);
    return 2;
  }
  const logger = deps.logger ?? createLogger();
  let config;
  try {
    config = loadConfig(args.configPath);
  } catch (error) {
    logConfigProblem(
      error instanceof ConfigError ? error.message : 'cannot load the configuration',
    );
    return 1;
  }
  const proxy = createProxyServer(config, { ...deps, logger });
  return new Promise<number | Running>((resolve) => {
    proxy.server.once('error', (error) => {
      logger.log({ event: 'server-error', code: errorCode(error) });
      resolve(1);
    });
    proxy.server.listen(config.listen.port, config.listen.host, () => {
      const address = proxy.server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : config.listen.port;
      logger.log({
        event: 'startup',
        port,
        allowedHosts: config.upstream.allowedHosts.length,
        allowedOrigins: config.allowedOrigins.length,
      });
      resolve({
        port,
        close: async () => {
          await proxy.close();
          logger.log({ event: 'shutdown' });
        },
      });
    });
  });
}

// `import.meta.main` (Node >= 24.2) is robust to path spelling (e.g. drive-letter case on Windows).
const isEntryPoint =
  (import.meta.main as boolean | undefined) ??
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isEntryPoint) {
  // Signal handlers first, so a SIGINT/SIGTERM during startup still exits cleanly.
  const started = main(process.argv.slice(2));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Give open streams a moment to close, then exit regardless.
    setTimeout(() => process.exit(0), 3000).unref();
    void started
      .then((result) => (typeof result === 'number' ? undefined : result.close()))
      .then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const result = await started;
  if (typeof result === 'number') {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    process.exitCode = result;
  }
}
