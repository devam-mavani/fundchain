const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const DAY = 24 * 60 * 60;
const GOAL = ethers.parseEther("10");

async function deployFixture() {
  const [creator, alice, bob, stranger] = await ethers.getSigners();
  const fc = await (await ethers.getContractFactory("FundChain")).deploy();
  await fc.connect(creator).createCampaign("Solar School", "Panels for a school", GOAL, 7 * DAY);
  return { fc, creator, alice, bob, stranger };
}

describe("FundChain", () => {
  it("creates a campaign", async () => {
    const { fc, creator } = await loadFixture(deployFixture);
    const c = await fc.getCampaign(0);
    expect(c.creator).to.equal(creator.address);
    expect(c.goal).to.equal(GOAL);
    expect(await fc.campaignCount()).to.equal(1);
    expect(await fc.status(0)).to.equal(0); // Active
  });

  it("rejects invalid campaigns", async () => {
    const { fc } = await loadFixture(deployFixture);
    await expect(fc.createCampaign("", "x", GOAL, DAY)).to.be.revertedWithCustomError(fc, "InvalidInput");
    await expect(fc.createCampaign("t", "x", 0, DAY)).to.be.revertedWithCustomError(fc, "InvalidInput");
    await expect(fc.createCampaign("t", "x", GOAL, 0)).to.be.revertedWithCustomError(fc, "InvalidInput");
  });

  it("tracks contributions and contributors", async () => {
    const { fc, alice, bob } = await loadFixture(deployFixture);
    await fc.connect(alice).contribute(0, { value: ethers.parseEther("3") });
    await fc.connect(alice).contribute(0, { value: ethers.parseEther("1") });
    await fc.connect(bob).contribute(0, { value: ethers.parseEther("2") });

    expect((await fc.getCampaign(0)).totalRaised).to.equal(ethers.parseEther("6"));
    expect(await fc.contributions(0, alice.address)).to.equal(ethers.parseEther("4"));
    expect(await fc.getContributors(0)).to.deep.equal([alice.address, bob.address]);
  });

  it("blocks contributions after the deadline or with zero value", async () => {
    const { fc, alice } = await loadFixture(deployFixture);
    await expect(fc.connect(alice).contribute(0, { value: 0 })).to.be.revertedWithCustomError(fc, "InvalidInput");
    await time.increase(7 * DAY);
    await expect(fc.connect(alice).contribute(0, { value: 1 })).to.be.revertedWithCustomError(fc, "CampaignEnded");
  });

  describe("successful campaign", () => {
    async function funded() {
      const s = await deployFixture();
      await s.fc.connect(s.alice).contribute(0, { value: ethers.parseEther("6") });
      await s.fc.connect(s.bob).contribute(0, { value: ethers.parseEther("5") });
      return s;
    }

    it("lets only the creator withdraw, only after the deadline, only once", async () => {
      const { fc, creator, alice } = await loadFixture(funded);
      await expect(fc.connect(creator).withdraw(0)).to.be.revertedWithCustomError(fc, "CampaignNotEnded");
      await time.increase(7 * DAY);
      await expect(fc.connect(alice).withdraw(0)).to.be.revertedWithCustomError(fc, "NotCreator");
      await expect(fc.connect(creator).withdraw(0)).to.changeEtherBalance(creator, ethers.parseEther("11"));
      expect(await fc.status(0)).to.equal(3); // Withdrawn
      await expect(fc.connect(creator).withdraw(0)).to.be.revertedWithCustomError(fc, "AlreadyWithdrawn");
    });

    it("does not allow refunds", async () => {
      const { fc, alice } = await loadFixture(funded);
      await time.increase(7 * DAY);
      await expect(fc.connect(alice).refund(0)).to.be.revertedWithCustomError(fc, "GoalReached");
    });
  });

  describe("failed campaign", () => {
    async function underfunded() {
      const s = await deployFixture();
      await s.fc.connect(s.alice).contribute(0, { value: ethers.parseEther("3") });
      await s.fc.connect(s.bob).contribute(0, { value: ethers.parseEther("2") });
      return s;
    }

    it("refunds each contributor exactly once", async () => {
      const { fc, alice, bob, stranger } = await loadFixture(underfunded);
      await expect(fc.connect(alice).refund(0)).to.be.revertedWithCustomError(fc, "CampaignNotEnded");
      await time.increase(7 * DAY);
      expect(await fc.status(0)).to.equal(2); // Failed

      await expect(fc.connect(alice).refund(0)).to.changeEtherBalance(alice, ethers.parseEther("3"));
      await expect(fc.connect(alice).refund(0)).to.be.revertedWithCustomError(fc, "NothingToRefund");
      await expect(fc.connect(bob).refund(0)).to.changeEtherBalance(bob, ethers.parseEther("2"));
      await expect(fc.connect(stranger).refund(0)).to.be.revertedWithCustomError(fc, "NothingToRefund");
    });

    it("does not let the creator withdraw", async () => {
      const { fc, creator } = await loadFixture(underfunded);
      await time.increase(7 * DAY);
      await expect(fc.connect(creator).withdraw(0)).to.be.revertedWithCustomError(fc, "GoalNotReached");
    });
  });

  it("reverts on unknown campaign ids", async () => {
    const { fc } = await loadFixture(deployFixture);
    await expect(fc.getCampaign(99)).to.be.revertedWithCustomError(fc, "InvalidCampaign");
  });
});
