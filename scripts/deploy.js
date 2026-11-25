const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const FundChain = await hre.ethers.getContractFactory("FundChain");
  const fundChain = await FundChain.deploy();
  await fundChain.waitForDeployment();

  const address = await fundChain.getAddress();
  console.log("FundChain deployed to:", address);

  // Hand the address to the frontend
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const out = `window.FUNDCHAIN_CONFIG = { address: "${address}", chainId: ${chainId} };\n`;
  fs.writeFileSync(path.join(__dirname, "../frontend/config.js"), out);
  console.log("Wrote frontend/config.js");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
