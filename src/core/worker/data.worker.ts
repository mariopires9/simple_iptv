// Data worker entry point — FND-07 (ADR-009). Loaded by client.ts as its own chunk.
// Do not access the DOM or import UI modules: everything that runs here comes from api.ts/tasks.ts.
import { expose } from 'comlink';
import { createDataWorkerApi } from './api';

expose(createDataWorkerApi());
