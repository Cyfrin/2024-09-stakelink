import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import {
  toEther,
  deploy,
  deployUpgradeable,
  getAccounts,
  setupToken,
  fromEther,
} from '../utils/helpers'
import {
  ERC677,
  StrategyMock,
  StakingPool,
  RebaseController,
  SDLPoolCCIPControllerMock,
  PriorityPool,
  InsurancePool,
} from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers'

describe('RebaseController', () => {
  const decode = (data: any) =>
    ethers.AbiCoder.defaultAbiCoder().decode(['uint256[]', 'uint256'], data)
  const encode = (data: any) =>
    ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]', 'uint256'], data)

  async function deployFixture() {
    const { signers, accounts } = await getAccounts()
    const adrs: any = {}

    const token = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Chainlink',
      'LINK',
      1000000000,
    ])) as ERC677
    adrs.token = await token.getAddress()

    await setupToken(token, accounts)

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'LinkPool LINK',
      'lpLINK',
      [[accounts[4], 1000]],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const priorityPool = (await deployUpgradeable('PriorityPool', [
      adrs.token,
      adrs.stakingPool,
      accounts[0],
      toEther(100),
      toEther(1000),
    ])) as PriorityPool
    adrs.priorityPool = await priorityPool.getAddress()

    const sdlPoolCCIPController = (await deploy('SDLPoolCCIPControllerMock', [
      accounts[0],
      accounts[0],
    ])) as SDLPoolCCIPControllerMock
    adrs.sdlPoolCCIPController = await sdlPoolCCIPController.getAddress()

    const insurancePool = (await deployUpgradeable('InsurancePool', [
      adrs.token,
      'name',
      'symbol',
      accounts[0],
      3000,
      10,
      100,
    ])) as InsurancePool
    adrs.insurancePool = await insurancePool.getAddress()

    const rebaseController = (await deploy('RebaseController', [
      adrs.stakingPool,
      adrs.priorityPool,
      adrs.sdlPoolCCIPController,
      adrs.insurancePool,
      accounts[0],
      3000,
    ])) as RebaseController
    adrs.rebaseController = await rebaseController.getAddress()

    const strategy1 = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(200),
      toEther(10),
    ])) as StrategyMock
    adrs.strategy1 = await strategy1.getAddress()

    const strategy2 = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(200),
      toEther(20),
    ])) as StrategyMock
    adrs.strategy2 = await strategy2.getAddress()

    const strategy3 = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock
    adrs.strategy3 = await strategy3.getAddress()

    await stakingPool.addStrategy(adrs.strategy1)
    await stakingPool.addStrategy(adrs.strategy2)
    await stakingPool.addStrategy(adrs.strategy3)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(adrs.rebaseController)
    await priorityPool.setRebaseController(adrs.rebaseController)
    await insurancePool.setRebaseController(adrs.rebaseController)

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], toEther(1000), ['0x', '0x', '0x'])

    return {
      signers,
      accounts,
      adrs,
      token,
      stakingPool,
      priorityPool,
      sdlPoolCCIPController,
      insurancePool,
      rebaseController,
      strategy1,
      strategy2,
      strategy3,
    }
  }

  it('checkUpkeep should work correctly', async () => {
    const { adrs, token, rebaseController, strategy1, strategy3 } = await loadFixture(deployFixture)

    await token.transfer(adrs.strategy2, toEther(100))

    let data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')

    await strategy3.simulateSlash(toEther(20))

    data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => Number(v)),
      [2]
    )
    assert.equal(fromEther(decode(data[1])[1]), 20)

    await strategy1.simulateSlash(toEther(30))

    data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], true, 'upkeepNeeded incorrect')
    assert.deepEqual(
      decode(data[1])[0].map((v: any) => Number(v)),
      [0, 2]
    )
    assert.equal(fromEther(decode(data[1])[1]), 50)
  })

  it('performUpkeep should work correctly', async () => {
    const {
      adrs,
      token,
      rebaseController,
      strategy1,
      strategy2,
      strategy3,
      stakingPool,
      priorityPool,
      insurancePool,
    } = await loadFixture(deployFixture)

    await token.transfer(adrs.strategy2, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rebaseController.performUpkeep(encode([[0, 2], toEther(20)]))

    let data = await rebaseController.checkUpkeep('0x00')
    assert.equal(data[0], false, 'upkeepNeeded incorrect')
    assert.equal(
      fromEther(await strategy1.getDepositChange()),
      0,
      'strategy1 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy2.getDepositChange()),
      100,
      'strategy2 depositChange incorrect'
    )
    assert.equal(
      fromEther(await strategy3.getDepositChange()),
      0,
      'strategy3 depositChange incorrect'
    )

    await expect(rebaseController.performUpkeep(encode([[], 10]))).to.be.revertedWithCustomError(
      rebaseController,
      'NoStrategiesToUpdate()'
    )
    await expect(rebaseController.performUpkeep(encode([[1], 0]))).to.be.revertedWithCustomError(
      rebaseController,
      'NoStrategiesToUpdate()'
    )

    await strategy3.simulateSlash(toEther(301))
    await rebaseController.performUpkeep(encode([[2], toEther(301)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 980)
    assert.equal(Number(await priorityPool.poolStatus()), 2)
    assert.equal(await insurancePool.claimInProgress(), true)
  })

  it('pausing process should work correctly when max loss is exceeded', async () => {
    const { adrs, token, rebaseController, strategy3, stakingPool, priorityPool, insurancePool } =
      await loadFixture(deployFixture)

    await strategy3.simulateSlash(toEther(300))
    await rebaseController.performUpkeep(encode([[2], toEther(300)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 700)
    assert.equal(Number(await priorityPool.poolStatus()), 0)
    assert.equal(await insurancePool.claimInProgress(), false)

    await token.transfer(adrs.strategy3, toEther(300))
    await rebaseController.updateRewards([2], '0x', [])
    await strategy3.simulateSlash(toEther(301))
    await rebaseController.performUpkeep(encode([[2], toEther(301)]))

    assert.equal(fromEther(await stakingPool.totalStaked()), 1000)
    assert.equal(Number(await priorityPool.poolStatus()), 2)
    assert.equal(await insurancePool.claimInProgress(), true)
    await expect(rebaseController.performUpkeep(encode([[2], 1]))).to.be.revertedWithCustomError(
      rebaseController,
      'PoolClosed()'
    )
    await expect(rebaseController.updateRewards([2], '0x', [])).to.be.revertedWithCustomError(
      rebaseController,
      'PoolClosed()'
    )
    assert.equal((await rebaseController.checkUpkeep('0x00'))[0], false)

    await stakingPool.donateTokens(toEther(101))
    await rebaseController.reopenPool([2])
    assert.equal(fromEther(await stakingPool.totalStaked()), 800)
    assert.equal(Number(await priorityPool.poolStatus()), 0)
    assert.equal(await insurancePool.claimInProgress(), false)
  })

  it('updateRewards should work correctly', async () => {
    const {
      adrs,
      token,
      rebaseController,
      strategy1,
      strategy2,
      strategy3,
      sdlPoolCCIPController,
    } = await loadFixture(deployFixture)

    await token.transfer(adrs.strategy2, toEther(100))
    await strategy1.simulateSlash(toEther(10))
    await strategy3.simulateSlash(toEther(10))

    await rebaseController.updateRewards([0, 2], '0x', [])

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 100)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal(Number(await sdlPoolCCIPController.rewardsDistributed()), 1)

    await token.transfer(adrs.strategy2, toEther(10))
    await token.transfer(adrs.strategy3, toEther(20))

    await rebaseController.updateRewards([0, 1, 2], '0x', [])

    assert.equal(fromEther(await strategy1.getDepositChange()), 0)
    assert.equal(fromEther(await strategy2.getDepositChange()), 0)
    assert.equal(fromEther(await strategy3.getDepositChange()), 0)
    assert.equal(Number(await sdlPoolCCIPController.rewardsDistributed()), 2)
  })
})
