import { createClient, http } from "viem";
import { beforeEach, expect, test } from "vitest";

import { usdcContractConfig } from "@/_test/constants";
import { setupEventStore } from "@/_test/setup";
import { anvil } from "@/_test/utils";

import { buildReadContract } from "./readContract";
import { ponderTransport } from "./transport";

beforeEach((context) => setupEventStore(context));

const usdcTotalSupply16375000 = 40921687992499550n;

test("readContract() no cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const readContract = buildReadContract({
    getCurrentBlockNumber: () => 16375000n,
  });

  const totalSupply = await readContract(client, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});

test("readContract() with cache", async ({ eventStore }) => {
  const client = createClient({
    chain: anvil,
    transport: ponderTransport({ transport: http(), eventStore }),
  });

  const readContract = buildReadContract({
    getCurrentBlockNumber: () => 16375000n,
  });

  let totalSupply = await readContract(client, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);

  totalSupply = await readContract(client, {
    abi: usdcContractConfig.abi,
    functionName: "totalSupply",
    address: usdcContractConfig.address,
  });

  expect(totalSupply).toBe(usdcTotalSupply16375000);
});
