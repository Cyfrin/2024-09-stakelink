import { assert, expect } from 'chai'
import { Signer } from 'ethers'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC20,
  SequencerVault,
  MetisLockingPoolMock,
  SequencerVCSMock,
  MetisLockingInfoMock,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('SequencerVault', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Metis',
      'METIS',
      1000000000,
    ])) as ERC20
    adrs.token = await token.getAddress()

    const metisLockingInfo = (await deploy('MetisLockingInfoMock', [
      adrs.token,
      toEther(100),
      toEther(10000),
    ])) as MetisLockingInfoMock
    adrs.metisLockingInfo = await metisLockingInfo.getAddress()

    const metisLockingPool = (await deploy('MetisLockingPoolMock', [
      adrs.token,
      adrs.metisLockingInfo,
    ])) as MetisLockingPoolMock
    adrs.metisLockingPool = await metisLockingPool.getAddress()

    const strategy = (await deploy('SequencerVCSMock', [
      adrs.token,
      adrs.metisLockingInfo,
      1000,
      5000,
    ])) as SequencerVCSMock
    adrs.strategy = await strategy.getAddress()

    const vault = (await deployUpgradeable('SequencerVault', [
      adrs.token,
      adrs.strategy,
      adrs.metisLockingPool,
      adrs.metisLockingInfo,
      '0x5555',
      accounts[1],
      accounts[2],
    ])) as SequencerVault
    adrs.vault = await vault.getAddress()

    await strategy.addVault(adrs.vault)
    await token.approve(adrs.strategy, toEther(100000000))

    return { signers, accounts, adrs, token, metisLockingInfo, metisLockingPool, strategy, vault }
  }

  it('deposit should work correctly', async () => {
    const { adrs, strategy, token, vault } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 100)
    assert.equal(fromEther(await vault.getTotalDeposits()), 100)
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)
    assert.equal(Number(await vault.seqId()), 1)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 200)
    assert.equal(fromEther(await vault.getTotalDeposits()), 200)
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 200)
    assert.equal(Number(await vault.seqId()), 1)
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { strategy, vault } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    await strategy.deposit(toEther(30))
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 130)
  })

  it('getRewards should work correctly', async () => {
    const { strategy, vault, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getRewards()), 10)
  })

  it('getTotalDeposits should work correctly', async () => {
    const { strategy, vault, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await strategy.deposit(toEther(50))
    await metisLockingPool.addReward(1, toEther(15))
    assert.equal(fromEther(await vault.getTotalDeposits()), 175)
  })

  it('getPendingRewards should work correctly', async () => {
    const { strategy, vault, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
    await metisLockingPool.addReward(1, toEther(5))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)

    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await metisLockingPool.addReward(1, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
  })

  it('updateDeposits should work correctly', async () => {
    const { strategy, vault, metisLockingPool, metisLockingInfo } = await loadFixture(deployFixture)

    await metisLockingInfo.setMaxLock(toEther(100))
    await strategy.deposit(toEther(100))
    await metisLockingPool.addReward(1, toEther(10))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0)).map((v: any) => fromEther(v)),
      [110, 1, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await metisLockingPool.slashPrincipal(1, toEther(5))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0)).map((v: any) => fromEther(v)),
      [105, 0, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await metisLockingPool.addReward(1, toEther(8))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0)).map((v) => fromEther(v)),
      [113, 0.3, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.3)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 113)

    await metisLockingPool.addReward(1, toEther(1))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0)).map((v) => fromEther(v)),
      [114, 0.1, 0]
    )
    await strategy.updateDeposits(0)
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 114)

    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(toEther(20))).map((v) => fromEther(v)),
      [114, 0, 0]
    )
    await strategy.updateDeposits(toEther(20))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 114)

    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(toEther(19), { value: toEther(1) })).map((v) =>
        fromEther(v)
      ),
      [95, 0, 19]
    )
    await strategy.updateDeposits(toEther(19), { value: toEther(1) })
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 1.4)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 95)

    await metisLockingInfo.setMaxLock(toEther(120))
    await metisLockingPool.addReward(1, toEther(7))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(toEther(7))).map((v) => fromEther(v)),
      [102, 0.7, 0]
    )
    await strategy.updateDeposits(toEther(7))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.unclaimedRewards()), 2.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 102)

    await expect(vault.updateDeposits(0, 0)).to.be.revertedWithCustomError(
      vault,
      'SenderNotAuthorized()'
    )
  })

  it('withdrawRewards should work correctly', async () => {
    const { signers, strategy, vault, metisLockingPool } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))

    await metisLockingPool.addReward(1, toEther(10))
    await strategy.updateDeposits(0)

    await expect(vault.withdrawRewards()).to.be.revertedWithCustomError(
      vault,
      'SenderNotAuthorized()'
    )

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.5)

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.25)

    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
  })
})
