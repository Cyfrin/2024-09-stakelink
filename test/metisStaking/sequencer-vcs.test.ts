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
  StakingPool,
  ERC20,
  MetisLockingInfoMock,
  MetisLockingPoolMock,
  SequencerVCS,
  SequencerVault,
  SequencerVaultV2Mock,
} from '../../typechain-types'
import { Interface } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('SequencerVCS', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
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
      toEther(1000),
    ])) as MetisLockingInfoMock
    adrs.metisLockingInfo = await metisLockingInfo.getAddress()

    const metisLockingPool = (await deploy('MetisLockingPoolMock', [
      adrs.token,
      adrs.metisLockingInfo,
    ])) as MetisLockingPoolMock
    adrs.metisLockingPool = await metisLockingPool.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'Staked LINK',
      'stLINK',
      [],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    let vaultImplementation = await deployImplementation('SequencerVault')

    const strategy = (await deployUpgradeable('SequencerVCS', [
      adrs.token,
      adrs.stakingPool,
      adrs.metisLockingInfo,
      accounts[0],
      vaultImplementation,
      accounts[1],
      [[accounts[4], 500]],
      1000,
    ])) as SequencerVCS
    adrs.strategy = await strategy.getAddress()

    await strategy.setCCIPController(accounts[0])
    await metisLockingInfo.setManager(adrs.metisLockingPool)
    await stakingPool.addStrategy(adrs.strategy)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    for (let i = 0; i < 5; i++) {
      await strategy.addVault('0x5555', accounts[1], accounts[2])
    }

    const vaults = await strategy.getVaults()

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await signers[0].sendTransaction({ to: adrs.strategy, value: toEther(10) })

    return {
      signers,
      accounts,
      adrs,
      token,
      metisLockingInfo,
      metisLockingPool,
      stakingPool,
      strategy,
      vaults,
    }
  }

  it('getVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    assert.deepEqual(await strategy.getVaults(), vaults)
  })

  it('should be able to add vault', async () => {
    const { accounts, adrs, strategy } = await loadFixture(deployFixture)

    await strategy.addVault('0x6666', accounts[2], accounts[5])
    assert.equal((await strategy.getVaults()).length, 6)
    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[5])
    assert.equal(await vault.token(), adrs.token)
    assert.equal(await vault.vaultController(), adrs.strategy)
    assert.equal(await vault.lockingPool(), adrs.metisLockingPool)
    assert.equal(await vault.pubkey(), '0x6666')
    assert.equal((await vault.getFunction('signer')()) as any, accounts[2])
    assert.equal(Number(await vault.seqId()), 0)
    assert.equal(await vault.rewardsReceiver(), accounts[5])
  })

  it('deposit should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(50), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 50)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 50)

    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 250)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 250)
  })

  it('depositQueuedTokens should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(5000), ['0x'])
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getTotalDeposits()), 5000)
    assert.equal(fromEther(await token.balanceOf(adrs.strategy)), 3800)
    assert.equal(fromEther(await token.balanceOf(adrs.metisLockingInfo)), 1200)

    let vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[1])
    assert.equal(fromEther(await vault.getTotalDeposits()), 500)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 500)

    vault = await ethers.getContractAt('SequencerVault', (await strategy.getVaults())[4])
    assert.equal(fromEther(await vault.getTotalDeposits()), 700)
    assert.equal(fromEther(await vault.getPrincipalDeposits()), 700)
  })

  it('getDepositChange should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token, metisLockingPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[0], toEther(5000), ['0x'])
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    assert.equal(fromEther(await strategy.getDepositChange()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    assert.equal(fromEther(await strategy.getDepositChange()), 100)

    await metisLockingPool.addReward(2, toEther(50))
    assert.equal(fromEther(await strategy.getDepositChange()), 150)

    await token.transfer(adrs.strategy, toEther(25))
    assert.equal(fromEther(await strategy.getDepositChange()), 175)

    await stakingPool.updateStrategyRewards([0], '0x')
    await metisLockingPool.addReward(1, toEther(50))
    await metisLockingPool.slashPrincipal(2, toEther(60))
    assert.equal(fromEther(await strategy.getDepositChange()), -10)
  })

  it('getPendingFees should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token, metisLockingPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[0], toEther(5000), ['0x'])
    await strategy.depositQueuedTokens([1, 4], [toEther(500), toEther(700)])

    await metisLockingPool.addReward(1, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 15)

    await metisLockingPool.addReward(2, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 30)

    await token.transfer(adrs.strategy, toEther(50))
    assert.equal(fromEther(await strategy.getPendingFees()), 32.5)

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getPendingFees()), 0)

    await metisLockingPool.addReward(1, toEther(100))
    await metisLockingPool.slashPrincipal(1, toEther(10))
    assert.equal(fromEther(await strategy.getPendingFees()), 13.5)

    await metisLockingPool.slashPrincipal(1, toEther(100))
    assert.equal(fromEther(await strategy.getPendingFees()), 0)
  })

  it('getMaxDeposits and getMinDeposits should work correctly', async () => {
    const { accounts, strategy, stakingPool } = await loadFixture(deployFixture)

    assert.equal(fromEther(await strategy.canDeposit()), 5000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 0)

    await stakingPool.deposit(accounts[0], toEther(2000), ['0x'])
    assert.equal(fromEther(await strategy.canDeposit()), 3000)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 2000)

    await stakingPool.deposit(accounts[0], toEther(3000), ['0x'])
    assert.equal(fromEther(await strategy.canDeposit()), 0)
    assert.equal(fromEther(await strategy.getMaxDeposits()), 5000)
    assert.equal(fromEther(await strategy.getMinDeposits()), 5000)
  })

  it('updateDeposits should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token, metisLockingPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[0], toEther(400), ['0x'])
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 0)

    await metisLockingPool.addReward(1, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await metisLockingPool.addReward(2, toEther(50))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 550)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 15.85)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 7.925)

    await token.transfer(adrs.strategy, toEther(90))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 640)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 18.31)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 13.66)
  })

  it('updateDeposits should work correctly with slashing', async () => {
    const { accounts, adrs, strategy, stakingPool, metisLockingPool } = await loadFixture(
      deployFixture
    )

    await stakingPool.deposit(accounts[0], toEther(400), ['0x'])
    await strategy.depositQueuedTokens([1, 4], [toEther(200), toEther(200)])

    await metisLockingPool.addReward(2, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 500)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 10)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 5)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 450)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 9)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[4])), 4.5)

    await metisLockingPool.slashPrincipal(2, toEther(50))
    await metisLockingPool.addReward(1, toEther(20))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 420)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 10.36)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 4.18)

    await metisLockingPool.addReward(2, toEther(100))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await strategy.getTotalDeposits()), 520)
    assert.equal(fromEther(await strategy.getDepositChange()), 0)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(adrs.strategy)).toFixed(2)), 12.7)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[4])).toFixed(2)), 10.13)
  })

  it('updateDeposits should work correctly with reward withdrawals', async () => {
    const { accounts, strategy, stakingPool, metisLockingInfo, metisLockingPool } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])
    await metisLockingInfo.setMaxLock(toEther(100))
    await strategy.depositQueuedTokens(
      [0, 1, 2, 3, 4],
      [toEther(100), toEther(100), toEther(100), toEther(100), toEther(100)]
    )

    await metisLockingPool.addReward(1, toEther(5))
    await metisLockingPool.addReward(2, toEther(7))
    await metisLockingPool.addReward(3, toEther(8))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1020)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1020)
    assert.equal(fromEther(await strategy.l2Rewards()), 0)

    await metisLockingPool.addReward(4, toEther(10))
    await metisLockingPool.addReward(5, toEther(7))
    await metisLockingPool.addReward(1, toEther(7))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1044)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1044)
    assert.equal(fromEther(await strategy.l2Rewards()), 22)
  })

  it('handleIncomingL2Rewards should work correctly', async () => {
    const { accounts, adrs, strategy, stakingPool, token, metisLockingInfo, metisLockingPool } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(1000), ['0x'])
    await strategy.depositQueuedTokens([0], [toEther(100)])
    await metisLockingInfo.setMaxLock(toEther(100))

    await metisLockingPool.addReward(1, toEther(10))

    await stakingPool.updateStrategyRewards(
      [0],
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'uint32', 'uint256'],
        [toEther(10), 0, toEther(1)]
      )
    )
    assert.equal(fromEther(await stakingPool.totalStaked()), 1010)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1010)
    assert.equal(fromEther(await strategy.l2Rewards()), 10)

    token.transfer(adrs.stakingPool, toEther(5))
    await strategy.handleIncomingL2Rewards(toEther(5))
    assert.equal(fromEther(await stakingPool.totalStaked()), 1010)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 1005)
    assert.equal(fromEther(await strategy.l2Rewards()), 5)
  })

  it('withdrawOperatorRewards should work correctly', async () => {
    const { signers, accounts, adrs, strategy, stakingPool, vaults, metisLockingPool } =
      await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(200), ['0x'])
    await strategy.depositQueuedTokens([0, 1], [toEther(100), toEther(100)])

    let vault = (await ethers.getContractAt('SequencerVault', vaults[0])) as SequencerVault

    expect(strategy.withdrawOperatorRewards(accounts[2], 1)).to.be.revertedWithCustomError(
      strategy,
      'SenderNotAuthorized()'
    )

    await metisLockingPool.addReward(1, toEther(10))
    await metisLockingPool.addReward(2, toEther(10))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [1, 1]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 1)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 1)

    vault = (await ethers.getContractAt('SequencerVault', vaults[1])) as SequencerVault

    await metisLockingPool.slashPrincipal(1, toEther(55))
    await stakingPool.updateStrategyRewards([0], '0x')
    assert.equal(fromEther(await vault.unclaimedRewards()), 1)
    await vault.connect(signers[2]).withdrawRewards()
    assert.equal(fromEther(await vault.unclaimedRewards()), 0.25)
    assert.deepEqual(
      (await strategy.getOperatorRewards()).map((v) => fromEther(v)),
      [0.25, 0]
    )
    assert.equal(fromEther(await stakingPool.balanceOf(adrs.strategy)), 0)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 1.5)
  })

  it('setOperatorRewardPercentage should work correctly', async () => {
    const { accounts, strategy, stakingPool, metisLockingPool } = await loadFixture(deployFixture)

    await stakingPool.deposit(accounts[0], toEther(300), ['0x'])
    await strategy.depositQueuedTokens([0], [toEther(300)])

    await expect(strategy.setOperatorRewardPercentage(10001)).to.be.revertedWithCustomError(
      strategy,
      'FeesTooLarge()'
    )
    await metisLockingPool.addReward(1, toEther(100))
    await strategy.setOperatorRewardPercentage(1500)
    assert.equal(Number(await strategy.operatorRewardPercentage()), 1500)
    assert.equal(fromEther(await strategy.getTotalDeposits()), 400)
  })

  it('upgradeVaults should work correctly', async () => {
    const { strategy, vaults } = await loadFixture(deployFixture)

    let vaultInterface = (await ethers.getContractFactory('SequencerVaultV2Mock'))
      .interface as Interface

    let newVaultImplementation = (await deployImplementation('SequencerVaultV2Mock')) as string
    await strategy.setVaultImplementation(newVaultImplementation)

    await strategy.upgradeVaults([0, 1], ['0x', '0x'])
    for (let i = 0; i < 2; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
    }

    await strategy.upgradeVaults(
      [2, 3],
      [
        vaultInterface.encodeFunctionData('initializeV2', [2]),
        vaultInterface.encodeFunctionData('initializeV2', [3]),
      ]
    )
    for (let i = 2; i < 4; i++) {
      let vault = (await ethers.getContractAt(
        'SequencerVaultV2Mock',
        vaults[i]
      )) as SequencerVaultV2Mock
      assert.equal(await vault.isUpgraded(), true)
      assert.equal(Number(await vault.getVersion()), i)
    }
  })

  it('setVaultImplementation should work correctly', async () => {
    const { accounts, strategy } = await loadFixture(deployFixture)

    await expect(strategy.setVaultImplementation(accounts[0])).to.be.revertedWithCustomError(
      strategy,
      'AddressNotContract()'
    )

    let newVaultImplementation = (await deployImplementation('SequencerVault')) as string
    await strategy.setVaultImplementation(newVaultImplementation)
    assert.equal(await strategy.vaultImplementation(), newVaultImplementation)
  })
})
