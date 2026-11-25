# FundChain — Decentralized Crowdfunding

An all-or-nothing crowdfunding dApp on Ethereum. Anyone can create a campaign with a goal and deadline.
Contributions sit in the smart contract. After the deadline:

- **Goal met** → the creator withdraws the funds.
- **Goal missed** → every contributor can reclaim their exact contribution.

No middleman, no admin keys, and every donation is publicly verifiable on-chain.

---

## 1. How it works

| Requirement | How FundChain does it |
|---|---|
| Create campaigns | `createCampaign(title, description, goal, durationSeconds)` stores a `Campaign` struct and emits `CampaignCreated` |
| Goals & deadlines | `goal` (wei) and `deadline` (`block.timestamp + duration`) are fixed at creation and can't be changed |
| Refunds if goal missed | `refund(id)` — available to contributors once `deadline` passed and `totalRaised < goal` |
| Transparent tracking | Per-contributor `contributions` mapping, `getContributors(id)`, and events for every action |

### Campaign lifecycle

```
Active ──(deadline passes)──┬── totalRaised ≥ goal ──► Successful ──withdraw()──► Withdrawn
                            └── totalRaised < goal ──► Failed ──refund() per contributor
```

### Why refunds are "pull", not "push"

A smart contract cannot wake itself up at the deadline, and looping over every contributor to send money
back is unbounded gas (one failing receiver could block everyone). The standard, safe pattern is
**pull payments**: after a failed deadline, each contributor calls `refund(id)` to claim their money.
To the user it feels automatic — the frontend shows a one-click "Refund" button on failed campaigns.
(If you want truly hands-off refunds, add a keeper like Chainlink Automation or a relayer that calls
`refund` on behalf of contributors — see *Extensions*.)

### Security choices

- **Checks-effects-interactions**: balances are zeroed / flags set *before* sending ETH.
- **Reentrancy guard** on `withdraw` and `refund`.
- **Custom errors** (cheaper gas, clear reasons).
- Solidity 0.8+ has built-in overflow checks.
- Funds can only leave via `withdraw` (creator, goal met) or `refund` (contributor, goal missed) — never both.
- Timestamps can be nudged by validators by a few seconds; fine for day-scale campaigns.

---

## 2. Project structure

```
fundchain/
├─ contracts/FundChain.sol      # the smart contract
├─ test/FundChain.test.js       # Hardhat tests (create, contribute, withdraw, refund, edge cases)
├─ scripts/deploy.js            # deploys + writes frontend/config.js
├─ frontend/index.html          # vanilla JS + ethers v6 UI
├─ frontend/config.js           # contract address/chain (auto-generated on deploy)
├─ hardhat.config.js
├─ package.json
└─ .env.example
```

## 3. Prerequisites

- Node.js 18+ and npm
- MetaMask browser extension
- (For testnet) a Sepolia RPC URL from Infura/Alchemy and free test ETH from a Sepolia faucet

## 4. Setup

```bash
cd fundchain
npm install
npm run compile
npm test
```

You should see all tests passing.

## 5. Run locally (fastest way to try it)

**Terminal 1** — start a local blockchain (prints 20 funded test accounts + private keys):

```bash
npm run node
```

**Terminal 2** — deploy and serve the frontend:

```bash
npm run deploy:local      # writes frontend/config.js
npm run frontend          # http://localhost:3000
```

**MetaMask setup**

1. Add network: RPC `http://127.0.0.1:8545`, Chain ID `31337`, symbol `ETH`.
2. Import 2–3 of the private keys printed by `npm run node` (these are public test keys — never use them on a real network).
3. Open http://localhost:3000 and click **Connect wallet**.

> If you restart `npm run node`, reset MetaMask's account activity (Settings → Advanced → Clear activity tab data) to avoid nonce errors.

## 6. Try the full flow

1. **Account A**: create a campaign — goal `2` ETH, duration `2` minutes.
2. **Account B**: contribute `1` ETH. Everything shows live in the "public ledger".
3. Wait for the deadline.
4. Goal missed (1 < 2) → **Account B** sees a **Refund** button → click it → ETH returns.
5. Repeat but contribute `2+` ETH total → after the deadline **Account A** sees **Withdraw funds**.

Tip: the local chain only advances time when blocks are mined, so after waiting, send any transaction
(or run `npx hardhat console --network localhost` and call `await network.provider.send("evm_mine")`)
and then refresh the page.

## 7. Deploy to Sepolia testnet

```bash
cp .env.example .env     # fill in SEPOLIA_RPC_URL and PRIVATE_KEY (a throwaway test wallet!)
npm run deploy:sepolia
npm run frontend
```

Switch MetaMask to Sepolia, connect, and use real (test) ETH. Optionally verify the contract on Etherscan
with `@nomicfoundation/hardhat-verify`.

## 8. Contract API reference

| Function | Who | Notes |
|---|---|---|
| `createCampaign(title, description, goal, durationSeconds)` | anyone | returns campaign `id` |
| `contribute(id)` payable | anyone | only before deadline; `msg.value > 0` |
| `withdraw(id)` | creator | after deadline, goal met, once |
| `refund(id)` | contributor | after deadline, goal missed, once per contributor |
| `getCampaign(id)` / `campaignCount()` | view | |
| `getContributors(id)` / `contributions(id, addr)` | view | transparent ledger |
| `status(id)` | view | `0 Active, 1 Successful, 2 Failed, 3 Withdrawn` |

Events: `CampaignCreated`, `Contributed`, `Withdrawn`, `Refunded` — index these with The Graph or ethers
`queryFilter` for activity feeds.

## 9. Extensions (next steps)

- **Auto-refunds** via Chainlink Automation / a relayer that batch-calls a `refundFor(id, address)` function.
- **Stablecoin donations** (ERC-20 `transferFrom`) so goals aren't exposed to ETH volatility.
- **Milestone-based release** — creator unlocks funds in tranches approved by contributors' votes.
- **Platform fee** (e.g. 1% on successful withdrawal).
- **Cancel before first contribution**, campaign images/IPFS metadata.
- **Event-driven frontend** with The Graph, plus a React/Next.js rewrite with wagmi + RainbowKit.
- **Security hardening**: fuzz tests (Foundry), Slither static analysis, then an audit before touching mainnet.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| "No contract address" in UI | Run a deploy script first (it writes `frontend/config.js`) |
| MetaMask nonce / "transaction underpriced" errors locally | Clear MetaMask activity data after restarting the local node |
| Refund/withdraw says "CampaignNotEnded" | Deadline hasn't passed on-chain yet — mine a block or wait |
| `PRIVATE_KEY` errors | Use the key without `0x`, from a throwaway wallet |
