import { hexToBigInt, hexToNumber, toHex } from "viem";
import { beforeEach, expect, test } from "vitest";

import {
  blockOne,
  blockOneLogs,
  blockOneTransactions,
  blockThree,
  blockTwo,
  blockTwoLogs,
  blockTwoTransactions,
  usdcContractConfig,
} from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import type { FactoryCriteria, LogFilterCriteria } from "@/config/sources";

beforeEach((context) => setupEventStore(context));

test("setup creates tables", async (context) => {
  const { eventStore } = context;

  const tables = await eventStore.db.introspection.getTables();
  const tableNames = tables.map((t) => t.name);
  expect(tableNames).toContain("blocks");
  expect(tableNames).toContain("logs");
  expect(tableNames).toContain("transactions");

  expect(tableNames).toContain("logFilters");
  expect(tableNames).toContain("logFilterIntervals");
  expect(tableNames).toContain("factories");
  expect(tableNames).toContain("factoryLogFilterIntervals");

  expect(tableNames).toContain("contractReadResults");
});

test("insertLogFilterInterval inserts block, transactions, and logs", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
    interval: {
      startBlock: hexToBigInt(blockOne.number!) - 100n,
      endBlock: hexToBigInt(blockOne.number!),
    },
  });

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertLogFilterInterval inserts log filter intervals", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
    block: blockOne,
    transactions: [],
    logs: [],
    interval: { startBlock: 0n, endBlock: 100n },
  });

  const logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("insertLogFilterInterval merges ranges on insertion", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockOne,
    transactions: [],
    logs: [],
    interval: {
      startBlock: hexToBigInt(blockOne.number!),
      endBlock: hexToBigInt(blockOne.number!),
    },
  });

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockThree,
    transactions: [],
    logs: [],
    interval: {
      startBlock: hexToBigInt(blockThree.number!),
      endBlock: hexToBigInt(blockThree.number!),
    },
  });

  let logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: usdcContractConfig.address },
  });

  expect(logFilterRanges).toMatchObject([
    [15495110, 15495110],
    [15495112, 15495112],
  ]);

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockTwo,
    transactions: [],
    logs: [],
    interval: {
      startBlock: hexToBigInt(blockTwo.number!),
      endBlock: hexToBigInt(blockTwo.number!),
    },
  });

  logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: usdcContractConfig.address },
  });

  expect(logFilterRanges).toMatchObject([[15495110, 15495112]]);
});

test("insertLogFilterInterval merges log intervals inserted concurrently", async (context) => {
  const { eventStore } = context;

  await Promise.all([
    eventStore.insertLogFilterInterval({
      chainId: usdcContractConfig.chainId,
      logFilter: { address: usdcContractConfig.address },
      block: blockOne,
      transactions: [],
      logs: [],
      interval: {
        startBlock: hexToBigInt(blockOne.number!),
        endBlock: hexToBigInt(blockOne.number!),
      },
    }),
    eventStore.insertLogFilterInterval({
      chainId: usdcContractConfig.chainId,
      logFilter: { address: usdcContractConfig.address },
      block: blockTwo,
      transactions: [],
      logs: [],
      interval: {
        startBlock: hexToBigInt(blockTwo.number!),
        endBlock: hexToBigInt(blockTwo.number!),
      },
    }),
    eventStore.insertLogFilterInterval({
      chainId: usdcContractConfig.chainId,
      logFilter: { address: usdcContractConfig.address },
      block: blockThree,
      transactions: [],
      logs: [],
      interval: {
        startBlock: hexToBigInt(blockThree.number!),
        endBlock: hexToBigInt(blockThree.number!),
      },
    }),
  ]);

  const logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: usdcContractConfig.address },
  });

  expect(logFilterRanges).toMatchObject([[15495110, 15495112]]);
});

test("getLogFilterIntervals respects log filter inclusivity rules", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {
      address: ["0xa", "0xb"],
      topics: [["0xc", "0xd"], null, "0xe", null],
    },
    block: blockOne,
    transactions: [],
    logs: [],
    interval: { startBlock: 0n, endBlock: 100n },
  });

  // This is a narrower inclusion criteria on `address` and `topic0`. Full range is available.
  let logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: ["0xa"], topics: [["0xc"], null, "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);

  // This is a broader inclusion criteria on `address`. No ranges available.
  logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: undefined, topics: [["0xc"], null, "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([]);

  // This is a narrower inclusion criteria on `topic1`. Full range available.
  logFilterRanges = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { address: ["0xa"], topics: [["0xc"], "0xd", "0xe", null] },
  });

  expect(logFilterRanges).toMatchObject([[0, 100]]);
});

test("getLogFilterRanges handles complex log filter inclusivity rules", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: {},
    block: blockOne,
    transactions: [],
    logs: [],
    interval: { startBlock: 0n, endBlock: 100n },
  });

  await eventStore.insertLogFilterInterval({
    chainId: 1,
    logFilter: { topics: [null, ["0xc", "0xd"]] },
    block: blockOne,
    transactions: [],
    logs: [],
    interval: { startBlock: 150n, endBlock: 250n },
  });

  // Broad criteria only includes broad intervals.
  let logFilterIntervals = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: {},
  });
  expect(logFilterIntervals).toMatchObject([[0, 100]]);

  // Narrower criteria includes both broad and specific intervals.
  logFilterIntervals = await eventStore.getLogFilterIntervals({
    chainId: 1,
    logFilter: { topics: [null, "0xc"] },
  });
  expect(logFilterIntervals).toMatchObject([
    [0, 100],
    [150, 250],
  ]);
});

test("insertFactoryChildAddressLogs inserts logs", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: blockOneLogs,
  });

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("getFactoryChildAddresses gets child addresses for topic location", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...blockOneLogs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
      {
        ...blockOneLogs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child30000000000000000000000000000000000",
          "0x000000000000000000000000child40000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
    ],
  });

  let iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 150n,
  });

  let results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild30000000000000000000000000000000000",
  ]);

  iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: { ...factoryCriteria, childAddressLocation: "topic2" },
    upToBlockNumber: 150n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild20000000000000000000000000000000000",
    "0xchild40000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses gets child addresses for offset location", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "offset32",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...blockOneLogs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000child10000000000000000000000000000000000000000000000000000000000child30000000000000000000000000000000000",
        blockNumber: toHex(100),
      },
      {
        ...blockOneLogs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
        ],
        data: "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000child20000000000000000000000000000000000000000000000000000000000child30000000000000000000000000000000000",
        blockNumber: toHex(100),
      },
    ],
  });

  const iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 150n,
  });

  const results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses respects upToBlockNumber argument", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...blockOneLogs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
      {
        ...blockOneLogs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
        blockNumber: toHex(200),
      },
    ],
  });

  let iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 150n,
  });

  let results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject(["0xchild10000000000000000000000000000000000"]);

  iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 250n,
  });

  results = [];
  for await (const page of iterator) results.push(...page);

  expect(results).toMatchObject([
    "0xchild10000000000000000000000000000000000",
    "0xchild20000000000000000000000000000000000",
  ]);
});

test("getFactoryChildAddresses paginates correctly", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...blockOneLogs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
      {
        ...blockOneLogs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child20000000000000000000000000000000000",
        ],
        blockNumber: toHex(200),
      },
      {
        ...blockOneLogs[1],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child30000000000000000000000000000000000",
        ],
        blockNumber: toHex(201),
      },
    ],
  });

  const iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 1000n,
    pageSize: 1,
  });

  let idx = 0;
  for await (const page of iterator) {
    if (idx === 0)
      expect(page).toMatchObject([
        "0xchild10000000000000000000000000000000000",
      ]);
    if (idx === 1)
      expect(page).toMatchObject([
        "0xchild20000000000000000000000000000000000",
      ]);
    if (idx === 2) {
      expect(page).toMatchObject([
        "0xchild30000000000000000000000000000000000",
      ]);
      expect((await iterator.next()).done).toBe(true);
    }
    idx++;
  }
});

test("getFactoryChildAddresses does not yield empty list", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  const iterator = eventStore.getFactoryChildAddresses({
    chainId: 1,
    factory: factoryCriteria,
    upToBlockNumber: 1000n,
  });

  let didYield = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _page of iterator) {
    didYield = true;
  }

  expect(didYield).toBe(false);
});

test("insertFactoryLogFilterInterval inserts block, transactions, and logs", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertFactoryLogFilterInterval inserts and merges child contract intervals", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockThree,
    transactions: [],
    logs: [],
    interval: { startBlock: 750n, endBlock: 1000n },
  });

  let intervals = await eventStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([
    [0, 500],
    [750, 1000],
  ]);

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
    interval: { startBlock: 501n, endBlock: 800n },
  });

  intervals = await eventStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 1000]]);
});

test("getFactoryLogFilterIntervals handles topic filtering rules", async (context) => {
  const { eventStore } = context;

  const factoryCriteria = {
    address: "0xfactory",
    eventSelector:
      "0x0000000000000000000000000000000000000000000factoryeventsignature",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
    interval: { startBlock: 0n, endBlock: 500n },
  });

  let intervals = await eventStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: factoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);

  intervals = await eventStore.getFactoryLogFilterIntervals({
    chainId: 1,
    factory: {
      ...factoryCriteria,
      topics: [
        "0x0000000000000000000000000000000000000000000factoryeventsignature",
      ],
    } as FactoryCriteria,
  });

  expect(intervals).toMatchObject([[0, 500]]);
});

test("insertRealtimeBlock inserts data", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  const transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  const logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("insertRealtimeInterval inserts log filter intervals", async (context) => {
  const { eventStore } = context;

  const logFilterCriteria = {
    address: usdcContractConfig.address,
  } satisfies LogFilterCriteria;

  const factoryCriteriaOne = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  const factoryCriteriaTwo = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "offset64",
  } satisfies FactoryCriteria;

  await eventStore.insertRealtimeInterval({
    chainId: 1,
    logFilters: [logFilterCriteria],
    factories: [factoryCriteriaOne, factoryCriteriaTwo],
    interval: { startBlock: 500n, endBlock: 550n },
  });

  expect(
    await eventStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    })
  ).toMatchObject([[500, 550]]);

  // Confirm log filters have been inserted for factory child address logs.
  expect(
    await eventStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: {
        address: factoryCriteriaOne.address,
        topics: [factoryCriteriaOne.eventSelector],
      },
    })
  ).toMatchObject([[500, 550]]);
  expect(
    await eventStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: {
        address: factoryCriteriaOne.address,
        topics: [factoryCriteriaOne.eventSelector],
      },
    })
  ).toMatchObject([[500, 550]]);

  // Also confirm factory log filters have been inserted.
  expect(
    await eventStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteriaOne,
    })
  ).toMatchObject([[500, 550]]);
  expect(
    await eventStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteriaTwo,
    })
  ).toMatchObject([[500, 550]]);
});

test("deleteRealtimeData deletes blocks, transactions and logs", async (context) => {
  const { eventStore } = context;

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
    interval: {
      startBlock: hexToBigInt(blockOne.number!),
      endBlock: hexToBigInt(blockOne.number!),
    },
  });

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: { address: usdcContractConfig.address },
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
    interval: {
      startBlock: hexToBigInt(blockTwo.number!),
      endBlock: hexToBigInt(blockTwo.number!),
    },
  });

  let blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(2);

  let transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(3);

  let logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(3);

  await eventStore.deleteRealtimeData({
    chainId: usdcContractConfig.chainId,
    fromBlock: hexToBigInt(blockOne.number!),
  });

  blocks = await eventStore.db.selectFrom("blocks").selectAll().execute();
  expect(blocks).toHaveLength(1);

  transactions = await eventStore.db
    .selectFrom("transactions")
    .selectAll()
    .execute();
  expect(transactions).toHaveLength(2);

  logs = await eventStore.db.selectFrom("logs").selectAll().execute();
  expect(logs).toHaveLength(2);
});

test("deleteRealtimeData updates interval data", async (context) => {
  const { eventStore } = context;

  const logFilterCriteria = {
    address: usdcContractConfig.address,
  } satisfies LogFilterCriteria;

  const factoryCriteria = {
    address: "0xparent",
    eventSelector: "0xa",
    childAddressLocation: "topic1",
  } satisfies FactoryCriteria;

  await eventStore.insertLogFilterInterval({
    chainId: usdcContractConfig.chainId,
    logFilter: logFilterCriteria,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
    interval: {
      startBlock: hexToBigInt(blockOne.number!),
      endBlock: hexToBigInt(blockTwo.number!),
    },
  });

  await eventStore.insertFactoryLogFilterInterval({
    chainId: 1,
    factory: factoryCriteria,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
    interval: {
      startBlock: hexToBigInt(blockOne.number!),
      endBlock: hexToBigInt(blockTwo.number!),
    },
  });

  expect(
    await eventStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    })
  ).toMatchObject([[15495110, 15495111]]);

  expect(
    await eventStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteria,
    })
  ).toMatchObject([[15495110, 15495111]]);

  await eventStore.deleteRealtimeData({
    chainId: usdcContractConfig.chainId,
    fromBlock: hexToBigInt(blockOne.number!),
  });

  expect(
    await eventStore.getLogFilterIntervals({
      chainId: 1,
      logFilter: logFilterCriteria,
    })
  ).toMatchObject([[15495110, 15495110]]);

  expect(
    await eventStore.getFactoryLogFilterIntervals({
      chainId: 1,
      factory: factoryCriteria,
    })
  ).toMatchObject([[15495110, 15495110]]);
});

test.skip("insertContractReadResult inserts a contract call", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const contractReadResults = await eventStore.db
    .selectFrom("contractReadResults")
    .selectAll()
    .execute();

  expect(contractReadResults).toHaveLength(1);
  expect(contractReadResults[0]).toMatchObject({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    result: "0x789",
  });
});

test.skip("insertContractReadResult upserts on conflict", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const contractReadResults = await eventStore.db
    .selectFrom("contractReadResults")
    .select(["address", "result"])
    .execute();

  expect(contractReadResults).toHaveLength(1);
  expect(contractReadResults[0]).toMatchObject({
    address: usdcContractConfig.address,
    result: "0x789",
  });

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789123",
  });

  const contractReadResultsUpdated = await eventStore.db
    .selectFrom("contractReadResults")
    .select(["address", "result"])
    .execute();

  expect(contractReadResultsUpdated).toHaveLength(1);
  expect(contractReadResultsUpdated[0]).toMatchObject({
    address: usdcContractConfig.address,
    result: "0x789123",
  });
});

test.skip("getContractReadResult returns data", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const contractReadResult = await eventStore.getContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
  });

  expect(contractReadResult).toMatchObject({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });
});

test.skip("getContractReadResult returns null if not found", async (context) => {
  const { eventStore } = context;

  await eventStore.insertContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x123",
    blockNumber: 100n,
    result: "0x789",
  });

  const contractReadResult = await eventStore.getContractReadResult({
    address: usdcContractConfig.address,
    chainId: 1,
    data: "0x125",
    blockNumber: 100n,
  });

  expect(contractReadResult).toBe(null);
});

test("getLogEvents returns log events", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [{ name: "noFilter", chainId: 1, criteria: {} }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].eventSourceName).toEqual("noFilter");

  expect(events[0].log).toMatchInlineSnapshot(`
    {
      "address": "0x15d4c048f83bd7e37d49ea4c83a07267ec4203da",
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15495110n,
      "data": "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
      "id": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd-0x6c",
      "logIndex": 108,
      "removed": false,
      "topics": [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x000000000000000000000000a00f99bc38b1ecda1fd70eaa1cd31d576a9f46b0",
        "0x000000000000000000000000f16e9b0d03470827a95cdfd0cb8a8a3b46969b91",
      ],
      "transactionHash": "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "transactionIndex": 69,
    }
  `);

  expect(events[0].block).toMatchInlineSnapshot(`
    {
      "baseFeePerGas": 0n,
      "difficulty": 12730590371363483n,
      "extraData": "0x",
      "gasLimit": 29999943n,
      "gasUsed": 0n,
      "hash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "miner": "0x0000000000000000000000000000000000000000",
      "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "nonce": "0x0000000000000000",
      "number": 15495110n,
      "parentHash": "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
      "receiptsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
      "size": 520n,
      "stateRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1662619503n,
      "totalDifficulty": 58750003716598352816469n,
      "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    }
  `);

  expect(events[0].transaction).toMatchInlineSnapshot(`
    {
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15495110n,
      "from": "0x1",
      "gas": 69420420n,
      "gasPrice": 69n,
      "hash": "0xa4b1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "input": "0x1",
      "nonce": 1,
      "r": "0x1",
      "s": "0x1",
      "to": "0x1",
      "transactionIndex": 1,
      "type": "legacy",
      "v": 1n,
      "value": 1n,
    }
  `);

  expect(events[1].log).toMatchInlineSnapshot(`
    {
      "address": "0x72d4c048f83bd7e37d49ea4c83a07267ec4203da",
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15495110n,
      "data": "0x0000000000000000000000000000000000000000000000000000002b3b6fb3d0",
      "id": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd-0x6d",
      "logIndex": 109,
      "removed": false,
      "topics": [],
      "transactionHash": "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "transactionIndex": 70,
    }
  `);

  expect(events[1].block).toMatchInlineSnapshot(`
    {
      "baseFeePerGas": 0n,
      "difficulty": 12730590371363483n,
      "extraData": "0x",
      "gasLimit": 29999943n,
      "gasUsed": 0n,
      "hash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "logsBloom": "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "miner": "0x0000000000000000000000000000000000000000",
      "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "nonce": "0x0000000000000000",
      "number": 15495110n,
      "parentHash": "0xe55516ad8029e53cd32087f14653d851401b05245abb1b2d6ed4ddcc597ac5a6",
      "receiptsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
      "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
      "size": 520n,
      "stateRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "timestamp": 1662619503n,
      "totalDifficulty": 58750003716598352816469n,
      "transactionsRoot": "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
    }
  `);

  expect(events[1].transaction).toMatchInlineSnapshot(`
    {
      "accessList": [
        {
          "address": "0x1",
          "storageKeys": [
            "0x1",
          ],
        },
      ],
      "blockHash": "0xebc3644804e4040c0a74c5a5bbbc6b46a71a5d4010fe0c92ebb2fdf4a43ea5dd",
      "blockNumber": 15495110n,
      "from": "0x1",
      "gas": 69420420n,
      "gasPrice": 69n,
      "hash": "0xc3f1f606b66105fa45cb5db23d2f6597075701e7f0e2367f4e6a39d17a8cf98b",
      "input": "0x1",
      "nonce": 1,
      "r": "0x1",
      "s": "0x1",
      "to": "0x1",
      "transactionIndex": 1,
      "type": "eip2930",
      "v": 1n,
      "value": 1n,
    }
  `);
});

test("getLogEvents filters on log filter with one address", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "singleAddress",
        chainId: 1,
        criteria: { address: blockOneLogs[0].address },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].log.address).toBe(blockOneLogs[0].address);
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on log filter with multiple addresses", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "multipleAddress",
        chainId: 1,
        criteria: {
          address: [blockOneLogs[0].address, blockOneLogs[1].address],
        },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "multipleAddress",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[1]).toMatchObject({
    eventSourceName: "multipleAddress",
    log: {
      address: blockOneLogs[1].address,
    },
  });
  expect(events).toHaveLength(2);
});

test("getLogEvents filters on log filter with single topic", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "singleTopic",
        chainId: 1,
        criteria: {
          topics: [blockOneLogs[0].topics[0] as `0x${string}`],
        },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "singleTopic",
    log: {
      topics: blockOneLogs[0].topics,
    },
  });
  expect(events[1]).toMatchObject({
    eventSourceName: "singleTopic",
    log: {
      topics: blockTwoLogs[0].topics,
    },
  });
  expect(events).toHaveLength(2);
});

test("getLogEvents filters on log filter with multiple topics", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "multipleTopics",
        chainId: 1,
        criteria: {
          topics: [
            blockOneLogs[0].topics[0] as `0x${string}`,
            blockOneLogs[0].topics[1] as `0x${string}`,
          ],
        },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "multipleTopics",
    log: {
      topics: blockOneLogs[0].topics,
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on simple factory", async (context) => {
  const { eventStore } = context;

  await eventStore.insertFactoryChildAddressLogs({
    chainId: 1,
    logs: [
      {
        ...blockOneLogs[0],
        address: "0xfactory",
        topics: [
          "0x0000000000000000000000000000000000000000000factoryeventsignature",
          "0x000000000000000000000000child10000000000000000000000000000000000",
        ],
        blockNumber: toHex(100),
      },
    ],
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs.map((l) => ({
      ...l,
      address: "0xchild10000000000000000000000000000000000",
    })),
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    factories: [
      {
        name: "simple",
        chainId: 1,
        criteria: {
          address: "0xfactory",
          eventSelector:
            "0x0000000000000000000000000000000000000000000factoryeventsignature",
          childAddressLocation: "topic1",
        },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "simple",
    log: { topics: blockTwoLogs[0].topics },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on fromBlock", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "fromBlock",
        chainId: 1,
        fromBlock: 15495111,
        criteria: {},
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "fromBlock",
    block: {
      number: 15495111n,
    },
  });
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on multiple filters", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      {
        name: "singleAddress", // This should match blockOneLogs[0]
        chainId: 1,
        criteria: { address: blockOneLogs[0].address },
      },
      {
        name: "singleTopic", // This should match blockOneLogs[0] AND blockTwoLogs[0]
        chainId: 1,
        criteria: {
          topics: [blockOneLogs[0].topics[0] as `0x${string}`],
        },
      },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0]).toMatchObject({
    eventSourceName: "singleAddress",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[1]).toMatchObject({
    eventSourceName: "singleTopic",
    log: {
      address: blockOneLogs[0].address,
    },
  });
  expect(events[2]).toMatchObject({
    eventSourceName: "singleTopic",
    log: {
      topics: blockTwoLogs[0].topics,
    },
  });
});

test("getLogEvents filters on fromTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: hexToNumber(blockTwo.timestamp!),
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [{ name: "noFilter", chainId: 1, criteria: {} }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events[0].block.hash).toBe(blockTwo.hash);
  expect(events).toHaveLength(1);
});

test("getLogEvents filters on toTimestamp (inclusive)", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: hexToNumber(blockOne.timestamp!),
    logFilters: [{ name: "noFilter", chainId: 1, criteria: {} }],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events.map((e) => e.block.hash)).toMatchObject([
    blockOne.hash,
    blockOne.hash,
  ]);
  expect(events).toHaveLength(2);
});

test("getLogEvents returns no events if includeEventSelectors is an empty array", async (context) => {
  const { eventStore } = context;

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockOne,
    transactions: blockOneTransactions,
    logs: blockOneLogs,
  });

  await eventStore.insertRealtimeBlock({
    chainId: 1,
    block: blockTwo,
    transactions: blockTwoTransactions,
    logs: blockTwoLogs,
  });

  const iterator = eventStore.getLogEvents({
    fromTimestamp: 0,
    toTimestamp: Number.MAX_SAFE_INTEGER,
    logFilters: [
      { name: "noFilter", chainId: 1, criteria: {}, includeEventSelectors: [] },
    ],
  });
  const events = [];
  for await (const page of iterator) events.push(...page.events);

  expect(events).toHaveLength(0);
});
