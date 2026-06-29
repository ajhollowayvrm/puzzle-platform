// DynamoDB single-table implementation of the core Store. The MatchService and
// AccountService run against this in Lambda exactly as they do against the
// in-memory store in tests — same interface, real persistence.
//
// Item layout (PK / SK):
//   USER#<id>           PROFILE        — user profile
//   HANDLE#<lower>      HANDLE         — handle reservation (uniqueness + login lookup)
//   TOKEN#<token>       TOKEN          — bearer token (DynamoDB TTL auto-expires)
//   MATCH#<id>          MATCH          — the match (source of truth; version-locked)
//   CODE#<code>         CODE           — invite-code → matchId
//   USER#<id>           MATCH#<id>     — membership row (list "my matches")
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  HandleTakenError,
  type MatchPatch,
  type MatchRecord,
  type Store,
  type TokenRecord,
  type UserRecord,
} from '@puzzle/core';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function matchItem(m: MatchRecord): Record<string, unknown> {
  return { PK: `MATCH#${m.matchId}`, SK: 'MATCH', ...m };
}
function membership(userId: string, matchId: string): Record<string, unknown> {
  return { PK: `USER#${userId}`, SK: `MATCH#${matchId}`, matchId };
}
function matchFromItem(i: Record<string, any>): MatchRecord {
  return {
    matchId: i.matchId,
    gameId: i.gameId,
    mode: i.mode,
    model: i.model,
    playerIds: i.playerIds ?? [],
    playerHandles: i.playerHandles ?? {},
    inviteCode: i.inviteCode ?? null,
    seed: i.seed,
    config: i.config ?? null,
    state: i.state ?? null,
    version: i.version,
    status: i.status,
    turn: i.turn ?? null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

// Build a version-guarded UpdateItem expression from a MatchPatch.
function buildUpdate(expectedVersion: number, patch: MatchPatch) {
  const names: Record<string, string> = { '#v': 'version' };
  const values: Record<string, unknown> = { ':ev': expectedVersion, ':one': 1 };
  const sets: string[] = ['#v = #v + :one'];
  const set = (alias: string, attr: string, val: unknown) => {
    names[`#${alias}`] = attr;
    values[`:${alias}`] = val;
    sets.push(`#${alias} = :${alias}`);
  };
  set('ua', 'updatedAt', patch.updatedAt);
  if ('state' in patch) set('st', 'state', patch.state ?? null);
  if (patch.status !== undefined) set('status', 'status', patch.status);
  if (patch.turn !== undefined) set('turn', 'turn', patch.turn);
  if (patch.playerIds !== undefined) set('pids', 'playerIds', patch.playerIds);
  if (patch.playerHandles !== undefined) set('ph', 'playerHandles', patch.playerHandles);
  return {
    UpdateExpression: 'SET ' + sets.join(', '),
    ConditionExpression: '#v = :ev',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

export class DynamoStore implements Store {
  constructor(private readonly table: string) {}

  // --- users ---
  async createUser(u: UserRecord): Promise<void> {
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: { PK: `HANDLE#${u.handleLower}`, SK: 'HANDLE', userId: u.userId },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { PK: `USER#${u.userId}`, SK: 'PROFILE', ...u },
              },
            },
          ],
        }),
      );
    } catch (e) {
      if ((e as Error).name === 'TransactionCanceledException') throw new HandleTakenError(u.handle);
      throw e;
    }
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: this.table, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }));
    if (!r.Item) return null;
    const i = r.Item;
    return {
      userId: i.userId,
      handle: i.handle,
      handleLower: i.handleLower,
      passwordHash: i.passwordHash,
      salt: i.salt,
      createdAt: i.createdAt,
    };
  }

  async getUserByHandle(handleLower: string): Promise<UserRecord | null> {
    const h = await doc.send(new GetCommand({ TableName: this.table, Key: { PK: `HANDLE#${handleLower}`, SK: 'HANDLE' } }));
    if (!h.Item) return null;
    return this.getUser(h.Item.userId);
  }

  // --- tokens ---
  async putToken(t: TokenRecord): Promise<void> {
    await doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `TOKEN#${t.token}`, SK: 'TOKEN', ...t, ttl: Math.floor(t.expiresAt / 1000) },
      }),
    );
  }
  async getToken(token: string): Promise<TokenRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: this.table, Key: { PK: `TOKEN#${token}`, SK: 'TOKEN' } }));
    if (!r.Item) return null;
    return { token: r.Item.token, userId: r.Item.userId, expiresAt: r.Item.expiresAt };
  }
  async deleteToken(token: string): Promise<void> {
    await doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: `TOKEN#${token}`, SK: 'TOKEN' } }));
  }

  // --- matches ---
  async createMatch(m: MatchRecord): Promise<void> {
    const items: object[] = [{ Put: { TableName: this.table, Item: matchItem(m) } }];
    for (const id of m.playerIds) items.push({ Put: { TableName: this.table, Item: membership(id, m.matchId) } });
    if (m.inviteCode) {
      items.push({
        Put: {
          TableName: this.table,
          Item: { PK: `CODE#${m.inviteCode}`, SK: 'CODE', matchId: m.matchId },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }
    await doc.send(new TransactWriteCommand({ TransactItems: items as never }));
  }

  async getMatch(matchId: string): Promise<MatchRecord | null> {
    const r = await doc.send(new GetCommand({ TableName: this.table, Key: { PK: `MATCH#${matchId}`, SK: 'MATCH' } }));
    return r.Item ? matchFromItem(r.Item) : null;
  }

  async getMatchByCode(inviteCode: string): Promise<MatchRecord | null> {
    const c = await doc.send(new GetCommand({ TableName: this.table, Key: { PK: `CODE#${inviteCode}`, SK: 'CODE' } }));
    if (!c.Item) return null;
    return this.getMatch(c.Item.matchId);
  }

  async listMatchesForUser(userId: string): Promise<MatchRecord[]> {
    const q = await doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'MATCH#' },
      }),
    );
    const ids = (q.Items ?? []).map((i) => i.matchId as string);
    if (ids.length === 0) return [];
    const b = await doc.send(
      new BatchGetCommand({
        RequestItems: { [this.table]: { Keys: ids.map((id) => ({ PK: `MATCH#${id}`, SK: 'MATCH' })) } },
      }),
    );
    const recs = (b.Responses?.[this.table] ?? []).map(matchFromItem);
    return recs.sort((a, b2) => b2.updatedAt - a.updatedAt);
  }

  async deleteMatch(matchId: string): Promise<void> {
    const m = await this.getMatch(matchId);
    if (!m) return;
    const items: object[] = [{ Delete: { TableName: this.table, Key: { PK: `MATCH#${matchId}`, SK: 'MATCH' } } }];
    for (const id of m.playerIds) items.push({ Delete: { TableName: this.table, Key: { PK: `USER#${id}`, SK: `MATCH#${matchId}` } } });
    if (m.inviteCode) items.push({ Delete: { TableName: this.table, Key: { PK: `CODE#${m.inviteCode}`, SK: 'CODE' } } });
    await doc.send(new TransactWriteCommand({ TransactItems: items as never }));
  }

  async updateMatch(matchId: string, expectedVersion: number, patch: MatchPatch): Promise<number | null> {
    const upd = buildUpdate(expectedVersion, patch);
    // A join also writes membership rows for the (now larger) roster → transaction.
    if (patch.playerIds) {
      const items: object[] = [
        { Update: { TableName: this.table, Key: { PK: `MATCH#${matchId}`, SK: 'MATCH' }, ...upd } },
        ...patch.playerIds.map((id) => ({ Put: { TableName: this.table, Item: membership(id, matchId) } })),
      ];
      try {
        await doc.send(new TransactWriteCommand({ TransactItems: items as never }));
        return expectedVersion + 1;
      } catch (e) {
        if ((e as Error).name === 'TransactionCanceledException') return null;
        throw e;
      }
    }
    try {
      const r = await doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `MATCH#${matchId}`, SK: 'MATCH' },
          ...upd,
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return (r.Attributes?.version as number) ?? expectedVersion + 1;
    } catch (e) {
      if ((e as Error).name === 'ConditionalCheckFailedException') return null;
      throw e;
    }
  }
}
