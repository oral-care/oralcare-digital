import { Client } from "pg";

// One pg.Client per call against the role's address, ended in finally (plan
// 10.5). Neon may need to wake up, so connecting gets 15 seconds and one retry.

const CONNECT_TIMEOUT_MS = 15_000;

async function connect(connectionString: string): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (attempt >= 2) throw error;
    }
  }
}

export async function withClient<T>(
  connectionString: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(connectionString);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
