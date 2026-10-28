// Ponto de entrada do worker de dados — FND-07 (ADR-009). Carregado por client.ts como chunk próprio.
// Não aceder ao DOM nem importar módulos de UI: tudo o que corre aqui vem de api.ts/tasks.ts.
import { expose } from 'comlink';
import { createDataWorkerApi } from './api';

expose(createDataWorkerApi());
