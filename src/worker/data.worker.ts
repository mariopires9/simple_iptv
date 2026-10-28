// Data worker entry point — FND-07 (ADR-009). Loaded by ./client.ts as its own chunk.
// Do not access the DOM or import UI modules.
import { expose } from 'comlink';
import { createDataWorkerApi } from '@/core/worker';
import { tasks } from './tasks';

expose(createDataWorkerApi({ tasks }));
