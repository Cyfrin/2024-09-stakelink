import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { toEther, deploy, deployUpgradeable, getAccounts, fromEther } from '../utils/helpers'
import {
  ERC677,
  OperatorVCSMock,
  OperatorVault,
  PFAlertsControllerMock,
  StakingMock,
  StakingRewardsMock,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

describe('OperatorVault', () => {
  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    const rewardsController = (await deploy('StakingRewardsMock', [
      adrs.token,
    ])) as StakingRewardsMock
    adrs.rewardsController = await rewardsController.getAddress()

    const stakingController = (await deploy('StakingMock', [
      adrs.token,
      adrs.rewardsController,
      toEther(10),
      toEther(100),
      toEther(10000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock
    adrs.stakingController = await stakingController.getAddress()

    const pfAlertsController = (await deploy('PFAlertsControllerMock', [
      adrs.token,
    ])) as PFAlertsControllerMock
    adrs.pfAlertsController = await pfAlertsController.getAddress()

    const strategy = (await deploy('OperatorVCSMock', [adrs.token, 1000, 5000])) as OperatorVCSMock
    adrs.strategy = await strategy.getAddress()

    const vault = (await deployUpgradeable('OperatorVault', [
      adrs.token,
      adrs.strategy,
      adrs.stakingController,
      adrs.rewardsController,
      adrs.pfAlertsController,
      accounts[1],
      accounts[2],
    ])) as OperatorVault
    adrs.vault = await vault.getAddress()

    await strategy.addVault(adrs.vault)
    await token.approve(adrs.strategy, toEther(100000000))
    await strategy.deposit(toEther(100))
    await token.transfer(adrs.rewardsController, toEther(1000))
    await token.transfer(adrs.pfAlertsController, toEther(1000))

    return {
      signers,
      accounts,
      adrs,
      token,
      rewardsController,
      stakingController,
      pfAlertsController,
      strategy,
      vault,
    }
  }

  it('deposit should work correctly', async () => {
    const { adrs, strategy, token, stakingController, vault } = await loadFixture(deployFixture)

    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 200)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(adrs.vault)), 200)
    assert.equal(fromEther(await vault.getTotalDeposits()), 200)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 200)
  })

  it('withdraw should work correctly', async () => {
    const { adrs, strategy, token, stakingController, vault } = await loadFixture(deployFixture)

    await strategy.unbond()

    await expect(strategy.withdraw(toEther(30))).to.be.revertedWithCustomError(
      stakingController,
      'NotInClaimPeriod()'
    )

    await time.increase(unbondingPeriod + 1)

    await strategy.withdraw(toEther(30))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingController)), 70)
    assert.equal(fromEther(await stakingController.getStakerPrincipal(adrs.vault)), 70)
    assert.equal(fromEther(await vault.getTotalDeposits()), 70)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 70)
  })

  it('raiseAlert should work correctly', async () => {
    const { signers, accounts, adrs, token, vault } = await loadFixture(deployFixture)

    await vault.connect(signers[1]).raiseAlert(accounts[5])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 11.7)
    assert.equal(fromEther(await token.balanceOf(adrs.vault)), 1.3)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.3)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)
    await expect(vault.raiseAlert(accounts[5])).to.be.revertedWithCustomError(
      vault,
      'OnlyOperator()'
    )
  })

  it('getPrincipalDeposits should work correctly', async () => {
    const { adrs, stakingController, vault } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
    await stakingController.removeOperator(adrs.vault)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 100)
  })

  it('getPendingRewards should work correctly', async () => {
    const { accounts, adrs, strategy, vault, rewardsController } = await loadFixture(deployFixture)

    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(adrs.vault, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)
    await rewardsController.setReward(adrs.vault, toEther(15))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await strategy.deposit(toEther(100))
    assert.equal(fromEther(await vault.getPendingRewards()), 1.5)
    await rewardsController.setReward(adrs.vault, toEther(10))
    assert.equal(fromEther(await vault.getPendingRewards()), 1)

    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    await rewardsController.setReward(adrs.vault, toEther(11))
    assert.equal(fromEther(await vault.getPendingRewards()), 0.1)
    await rewardsController.setReward(adrs.vault, toEther(6))
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, adrs, strategy, vault, rewardsController, stakingController } =
      await loadFixture(deployFixture)

    await rewardsController.setReward(adrs.vault, toEther(10))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v) => fromEther(v)),
      [110, 100, 1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(adrs.vault, toEther(5))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v) => fromEther(v)),
      [105, 100, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(adrs.vault, toEther(8))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v) => fromEther(v)),
      [108, 100, 0]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 110)

    await rewardsController.setReward(adrs.vault, toEther(11))
    assert.deepEqual(
      (await strategy.updateDeposits.staticCall(0, accounts[3])).map((v) => fromEther(v)),
      [111, 100, 0.1]
    )
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(12), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 111)

    await strategy.updateDeposits(toEther(11), accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1.1)
    assert.equal(fromEther(await vault.trackedTotalDeposits()), 100)

    await expect(vault.updateDeposits(0, accounts[0])).to.be.revertedWithCustomError(
      vault,
      'OnlyVaultController()'
    )
  })

  it('withdrawRewards should work correctly', async () => {
    const { signers, accounts, adrs, strategy, token, vault, rewardsController } =
      await loadFixture(deployFixture)

    await rewardsController.setReward(adrs.vault, toEther(10))
    await strategy.updateDeposits(0, accounts[3])

    await expect(vault.withdrawRewards()).to.be.revertedWithCustomError(
      vault,
      'OnlyRewardsReceiver()'
    )

    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.5)

    await vault.connect(signers[1]).raiseAlert(accounts[5])
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.25)
    assert.equal(fromEther(await token.balanceOf(accounts[2])), 1.3)

    await strategy.setWithdrawalPercentage(10000)
    await vault.connect(signers[2]).withdrawRewards()

    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
  })

  it('exitVault should work correctly', async () => {
    const { accounts, adrs, strategy, token, vault, rewardsController, stakingController } =
      await loadFixture(deployFixture)

    await rewardsController.setReward(adrs.vault, toEther(10))
    await strategy.updateDeposits(0, accounts[3])
    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    assert.equal(fromEther(await vault.getTotalDeposits()), 110)

    await expect(strategy.removeVault()).to.be.revertedWithCustomError(
      vault,
      'OperatorNotRemoved()'
    )

    await stakingController.removeOperator(adrs.vault)
    assert.deepEqual(
      (await strategy.removeVault.staticCall()).map((v) => fromEther(v)),
      [100, 10]
    )
    await strategy.removeVault()

    assert.equal(fromEther(await vault.getPendingRewards()), 0)
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0.5)
    assert.equal(fromEther(await vault.getTotalDeposits()), 0)
  })

  it('setRewardsReceiver should work correctly', async () => {
    const { signers, accounts, adrs } = await loadFixture(deployFixture)

    let newVault = (await deployUpgradeable('OperatorVault', [
      adrs.token,
      adrs.strategy,
      adrs.stakingController,
      adrs.rewardsController,
      adrs.pfAlertsController,
      accounts[1],
      ethers.ZeroAddress,
    ])) as OperatorVault

    await expect(
      newVault.connect(signers[1]).setRewardsReceiver(accounts[1])
    ).to.be.revertedWithCustomError(newVault, 'OnlyRewardsReceiver()')
    await newVault.setRewardsReceiver(accounts[1])

    await expect(newVault.setRewardsReceiver(accounts[0])).to.be.revertedWithCustomError(
      newVault,
      'OnlyRewardsReceiver()'
    )
    await newVault.connect(signers[1]).setRewardsReceiver(accounts[0])
    assert.equal(await newVault.rewardsReceiver(), accounts[0])
  })
})
