import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  fromEther,
  deployImplementation,
} from '../utils/helpers'
import {
  ERC677,
  OperatorVCS,
  OperatorVault,
  StakingMock,
  StakingRewardsMock,
  StakingPool,
  PFAlertsControllerMock,
  FundFlowController,
  CommunityVCS,
} from '../../typechain-types'
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'

const unbondingPeriod = 28 * 86400
const claimPeriod = 7 * 86400

const encode = (data: any) => ethers.AbiCoder.defaultAbiCoder().encode(['uint'], [data])
const encodeVaults = (vaults: number[]) => {
  return ethers.AbiCoder.defaultAbiCoder().encode(['uint64[]'], [vaults])
}

describe('OperatorVCS', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
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
      toEther(10000000),
      unbondingPeriod,
      claimPeriod,
    ])) as StakingMock
    adrs.stakingController = await stakingController.getAddress()

    let opVaultImplementation = await deployImplementation('OperatorVault')

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const pfAlertsController = (await deploy('PFAlertsControllerMock', [
      adrs.token,
    ])) as PFAlertsControllerMock
    adrs.pfAlertsController = await pfAlertsController.getAddress()

    const vaultDepositController = await deploy('VaultDepositController')

    const strategy = (await deployUpgradeable(
      'OperatorVCS',
      [
        adrs.token,
        adrs.stakingPool,
        adrs.stakingController,
        opVaultImplementation,
        [[accounts[4], 500]],
        9000,
        toEther(100),
        1000,
        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as OperatorVCS
    adrs.strategy = await strategy.getAddress()

    let comVaultImplementation = await deployImplementation('CommunityVault')

    const comSrategy = (await deployUpgradeable(
      'CommunityVCS',
      [
        adrs.token,
        adrs.stakingPool,
        adrs.stakingController,
        comVaultImplementation,
        [[accounts[4], 500]],
        9000,
        toEther(100),
        10,
        20,
        vaultDepositController.target,
      ],
      { unsafeAllow: ['delegatecall'] }
    )) as CommunityVCS

    const fundFlowController = (await deployUpgradeable('FundFlowController', [
      strategy.target,
      comSrategy.target,
      unbondingPeriod,
      claimPeriod,
      5,
    ])) as FundFlowController
    await strategy.setFundFlowController(fundFlowController.target)
    await comSrategy.setFundFlowController(fundFlowController.target)

    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.addStrategy(comSrategy.target)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    for (let i = 0; i < 15; i++) {
      await strategy.addVault(accounts[0], accounts[1], adrs.pfAlertsController)
    }

    const vaults = await strategy.getVaults()

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await token.transfer(adrs.rewardsController, toEther(10000))
    await token.transfer(adrs.pfAlertsController, toEther(10000))
    await stakingPool.deposit(accounts[0], 1000, [encodeVaults([])])

    return {
      signers,
      accounts,
      adrs,
      token,
      rewardsController,
      stakingController,
      stakingPool,
      strategy,
      vaults,
      fundFlowController,
    }
  }

  it('should be able to add vault', async () => {
    const { accounts, adrs, strategy } = await loadFixture(deployFixture)

    await strategy.addVault(accounts[1], accounts[2], accounts[5])
    assert.equal((await strategy.getVaults()).length, 16)
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[15])
    assert.equal(await vault.token(), adrs.token)
    assert.equal(await vault.stakeController(), adrs.stakingController)
    assert.equal(await vault.vaultController(), adrs.strategy)
    assert.equal(await vault.rewardsController(), adrs.rewardsController)
    assert.equal(await vault.pfAlertsController(), accounts[5])
    assert.equal(await vault.operator(), accounts[1])
    assert.equal(await vault.rewardsReceiver(), accounts[2])
  })

  it('getPendingFees should work correctly', async () => {
    const { adrs, strategy, token, rewardsController, stakingPool, vaults } = await loadFixture(
      deployFixture
    )

    await rewardsController.setReward(vaults[0], toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 15)

    await rewardsController.setReward(vaults[1], toEther(10))
    assert.equal(fromEther(await strategy.getPendingFees()), 16.5)

    await token.transfer(adrs.strategy, toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 19)

    await rewardsController.setReward(vaults[0], toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 4)

    await rewardsController.setReward(vaults[0], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 0)

    await rewardsController.setReward(vaults[3], toEther(15))
    await rewardsController.setReward(vaults[0], toEther(0))
    assert.equal(fromEther(await strategy.getPendingFees()), 1.5)

    await stakingPool.updateStrategyRewards([0], encode(0))
    await rewardsController.setReward(vaults[0], toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 2.5)
  })

  it('getMaxDeposits should work correctly', async () => {
    const { accounts, strategy, stakingController, stakingPool } = await loadFixture(deployFixture)

    await stakingController.setDepositLimits(toEther(1000), toEther(75000))
    await stakingPool.deposit(accounts[0], toEther(750000), [encodeVaults([])])
    assert.equal(fromEther(await strategy.canDeposit()), 375000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 1125000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 750000)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, rewardsController, token, vaults } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(400), [encodeVaults([])])

    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await rewardsController.setReward(vaults[1], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await rewardsController.setReward(vaults[2], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 15.85)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 7.925)

    await token.transfer(adrs.strategy, toEther(90))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 18.31)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 13.66)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingPool)), 90)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    const { accounts, adrs, strategy, stakingPool, rewardsController, vaults, stakingController } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(400), [encodeVaults([])])
    await rewardsController.setReward(vaults[2], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await stakingController.slashOperator(vaults[2], toEther(50))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 350)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4.5)

    await stakingController.slashOperator(vaults[2], toEther(50))
    await rewardsController.setReward(vaults[3], toEther(20))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await strategy.getTotalDeposits()), 420)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 300)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 10.36)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 4.18)
  })

  it('updateDeposits should work correctly with reward withdrawals', async () => {
    const { accounts, adrs, strategy, stakingPool, rewardsController, token, vaults } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(1000), [encodeVaults([])])
    await stakingPool.withdraw(accounts[0], accounts[0], 1000, [encodeVaults([])])
    await rewardsController.setReward(vaults[1], toEther(5))
    await rewardsController.setReward(vaults[3], toEther(7))
    await rewardsController.setReward(vaults[5], toEther(8))

    await stakingPool.updateStrategyRewards([0], encode(toEther(10)))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingPool)), 0)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1020)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1020)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 1000)

    await rewardsController.setReward(vaults[6], toEther(10))
    await rewardsController.setReward(vaults[7], toEther(7))
    await rewardsController.setReward(vaults[8], toEther(15))

    await stakingPool.updateStrategyRewards([0], encode(toEther(10)))
    assert.equal(fromEther(await token.balanceOf(adrs.stakingPool)), 25)
    assert.equal(fromEther(await stakingPool.totalStaked()), 1052)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1027)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 1000)
  })

  it('withdrawOperatorRewards should work correctly', async () => {
    const { signers, accounts, adrs, strategy, stakingPool, rewardsController, vaults } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(10), [encodeVaults([])])

    let vault = (await ethers.getContractAt('OperatorVault', vaults[0])) as OperatorVault

    expect(vault.withdrawRewards()).to.be.revertedWithCustomError(vault, 'OnlyRewardsReceiver')

    await rewardsController.setReward(vaults[0], toEther(10))
    await rewardsController.setReward(vaults[1], toEther(10))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 0)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [1, 1]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 1)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1)

    vault = (await ethers.getContractAt('OperatorVault', vaults[1])) as OperatorVault

    await rewardsController.setReward(vaults[0], toEther(0))
    await stakingPool.updateStrategyRewards([0], encode(0))
    assert.equal(fromEther(await vault.getUnclaimedRewards()), 1)
    await vault.connect(signers[1]).withdrawRewards()
    assert.equal(Number(fromEther(await vault.getUnclaimedRewards()).toFixed(2)), 0.33)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => Number(fromEther(v).toFixed(2))),
      [0.33, 0]
    )
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[1])).toFixed(2)), 1.33)
  })

  it('queueVaultRemoval should work correctly', async () => {
    const { accounts, strategy, stakingPool, vaults, stakingController, fundFlowController } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(1000), [encodeVaults([])])

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    await stakingPool.withdraw(accounts[0], accounts[0], toEther(130), [encodeVaults([0, 5])])
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    assert.equal(fromEther((await strategy.vaultGroups(0))[1]), 130)
    await expect(strategy.queueVaultRemoval(5)).to.be.revertedWithCustomError(
      strategy,
      'OperatorNotRemoved()'
    )

    await stakingController.removeOperator(vaults[5])
    await strategy.queueVaultRemoval(5)

    await expect(strategy.queueVaultRemoval(5)).to.be.revertedWithCustomError(
      strategy,
      'VaultRemovalAlreadyQueued()'
    )
    assert.deepEqual(await strategy.getVaultRemovalQueue(), [vaults[5]])
    assert.equal(fromEther(await strategy.totalUnbonded()), 200)
    assert.equal(fromEther(await strategy.vaultMaxDeposits()), 100)
    assert.equal(fromEther((await strategy.vaultGroups(0))[1]), 100)

    await stakingController.removeOperator(vaults[6])
    await stakingController.setDepositLimits(0, toEther(140))
    await strategy.queueVaultRemoval(6)

    assert.deepEqual(await strategy.getVaultRemovalQueue(), [vaults[5]])
    assert.equal((await strategy.getVaults()).length, 14)
    assert.equal(fromEther(await strategy.totalUnbonded()), 100)
    assert.equal(fromEther(await strategy.vaultMaxDeposits()), 140)
    assert.equal(fromEther((await strategy.vaultGroups(1))[1]), 40)
  })

  it('removeVault should work correctly', async () => {
    const {
      accounts,
      strategy,
      stakingPool,
      rewardsController,
      vaults,
      stakingController,
      fundFlowController,
      adrs,
      token,
    } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(1000), [encodeVaults([])])
    await rewardsController.setReward(vaults[5], toEther(40))
    await rewardsController.setReward(vaults[6], toEther(100))
    await stakingPool.updateStrategyRewards([0], encode(0))
    await rewardsController.setReward(vaults[5], toEther(50))

    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    await stakingPool.withdraw(accounts[0], accounts[0], toEther(130), [encodeVaults([0, 5])])
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()

    await stakingController.removeOperator(vaults[5])
    await strategy.queueVaultRemoval(5)

    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await time.increase(claimPeriod)
    await fundFlowController.updateVaultGroups()
    await stakingController.removeOperator(vaults[6])
    await strategy.queueVaultRemoval(6)

    await strategy.removeVault(0)

    assert.deepEqual(await strategy.getVaultRemovalQueue(), [vaults[6]])
    assert.deepEqual(await strategy.getVaults(), [...vaults.slice(0, 5), ...vaults.slice(6)])
    assert.equal(fromEther(await strategy.getTotalDeposits()), 900)
    assert.equal(fromEther(await strategy.totalPrincipalDeposits()), 800)
    assert.equal(fromEther(await token.balanceOf(adrs.stakingPool)), 120)
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    const { accounts, strategy, stakingPool, rewardsController, vaults } = await loadFixture(
      deployFixture
    )

    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWithCustomError(
      strategy,
      'InvalidPercentage()'
    )
    await stakingPool.deposit(accounts[0], toEther(300), [encodeVaults([])])
    await rewardsController.setReward(vaults[1], toEther(100))
    await strategy.setOperatorRewardPercentage(5000)
    assert.equal(Number(await strategy.operatorRewardPercentage()), 5000)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
  })

  it('setRewardsReceiver should work correctly', async () => {
    const { accounts, strategy, vaults } = await loadFixture(deployFixture)

    await expect(strategy.setRewardsReceiver(1, accounts[4])).to.be.revertedWithCustomError(
      await ethers.getContractAt('OperatorVault', vaults[0]),
      'OnlyRewardsReceiver()'
    )

    await strategy.addVault(accounts[0], ethers.ZeroAddress, accounts[3])
    await strategy.setRewardsReceiver(15, accounts[4])
    let vault = await ethers.getContractAt('OperatorVault', (await strategy.getVaults())[15])
    assert.equal(await vault.rewardsReceiver(), accounts[4])
  })
})
