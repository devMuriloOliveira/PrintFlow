import dotenv from 'dotenv';

dotenv.config();

export const config = {
  apiUrl:
    process.env.PRINTFLOW_API_URL ||
    'http://localhost:3333',

  wsUrl:
    process.env.PRINTFLOW_WS_URL ||
    'ws://localhost:3333',

  agentVersion: '0.1.0'
};