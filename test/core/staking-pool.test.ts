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
import { ERC677, StrategyMock, StakingPool, ERC677ReceiverMock } from '../../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('StakingPool', () => {
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

    const erc677Receiver = (await deploy('ERC677ReceiverMock')) as ERC677ReceiverMock
    adrs.erc677Receiver = await erc677Receiver.getAddress()

    const stakingPool = (await deployUpgradeable('StakingPool', [
      adrs.token,
      'LinkPool LINK',
      'lpLINK',
      [
        [accounts[4], 1000],
        [adrs.erc677Receiver, 2000],
      ],
      toEther(10000),
    ])) as StakingPool
    adrs.stakingPool = await stakingPool.getAddress()

    const strategy1 = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(1000),
      toEther(10),
    ])) as StrategyMock
    adrs.strategy1 = await strategy1.getAddress()

    const strategy2 = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(2000),
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

    async function stake(account: number, amount: number) {
      await token.connect(signers[account]).transfer(accounts[0], toEther(amount))
      await stakingPool.deposit(accounts[account], toEther(amount), ['0x', '0x', '0x'])
    }

    async function withdraw(account: number, amount: number) {
      await stakingPool.withdraw(accounts[account], accounts[account], toEther(amount), [
        '0x',
        '0x',
        '0x',
      ])
    }

    await stakingPool.addStrategy(adrs.strategy1)
    await stakingPool.addStrategy(adrs.strategy2)
    await stakingPool.addStrategy(adrs.strategy3)
    await stakingPool.setPriorityPool(accounts[0])
    await stakingPool.setRebaseController(accounts[0])

    await token.approve(adrs.stakingPool, ethers.MaxUint256)
    await stakingPool.deposit(accounts[0], 1000, ['0x', '0x'])

    return {
      signers,
      accounts,
      adrs,
      token,
      erc677Receiver,
      stakingPool,
      strategy1,
      strategy2,
      strategy3,
      stake,
      withdraw,
    }
  }

  it('derivative token metadata should be correct', async () => {
    const { stakingPool } = await loadFixture(deployFixture)

    assert.equal(await stakingPool.name(), 'LinkPool LINK', 'Name incorrect')
    assert.equal(await stakingPool.symbol(), 'lpLINK', 'Symbol incorrect')
    assert.equal(Number(await stakingPool.decimals()), 18, 'Decimals incorrect')
  })

  it('should be able to add new fee', async () => {
    const { accounts, adrs, stakingPool, erc677Receiver } = await loadFixture(deployFixture)

    await stakingPool.addFee(accounts[1], 500)
    assert.deepEqual(
      (await stakingPool.getFees()).map((fee) => [fee[0], fee[1]]),
      [
        [accounts[4], 1000n],
        [adrs.erc677Receiver, 2000n],
        [accounts[1], 500n],
      ],
      'fees incorrect'
    )
  })

  it('should be able to update existing fees', async () => {
    const { accounts, adrs, stakingPool } = await loadFixture(deployFixture)

    await stakingPool.updateFee(0, accounts[1], 100)
    assert.deepEqual(
      (await stakingPool.getFees()).map((fee) => [fee[0], fee[1]]),
      [
        [accounts[1], 100n],
        [adrs.erc677Receiver, 2000n],
      ],
      'fees incorrect'
    )

    await stakingPool.updateFee(0, accounts[2], 0)
    assert.equal((await stakingPool.getFees()).length, 1, 'fees incorrect')
  })

  it('should be able to add new strategies', async () => {
    const { adrs, stakingPool } = await loadFixture(deployFixture)

    const strategy = (await deployUpgradeable('StrategyMock', [
      adrs.token,
      adrs.stakingPool,
      toEther(10000),
      toEther(10),
    ])) as StrategyMock

    await stakingPool.addStrategy(await strategy.getAddress())
    assert.equal(
      (await stakingPool.getStrategies())[3],
      await strategy.getAddress(),
      'Strategy not added'
    )
  })

  it('should not be able to add strategy that has already been added', async () => {
    const { stakingPool, adrs } = await loadFixture(deployFixture)

    await expect(stakingPool.addStrategy(adrs.strategy3)).to.be.revertedWith(
      'Strategy already exists'
    )
  })

  it('should be able to remove strategies', async () => {
    const { stakingPool, adrs } = await loadFixture(deployFixture)

    await stakingPool.removeStrategy(1, '0x', '0x')
    let strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([adrs.strategy1, adrs.strategy3]),
      'Remaining strategies incorrect'
    )

    await stakingPool.removeStrategy(1, '0x', '0x')
    strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([adrs.strategy1]),
      'Remaining strategies incorrect'
    )
  })

  it('should not be able remove nonexistent strategy', async () => {
    const { stakingPool } = await loadFixture(deployFixture)

    await expect(stakingPool.removeStrategy(3, '0x', '0x')).to.be.revertedWith(
      'Strategy does not exist'
    )
  })

  it('should be able to reorder strategies', async () => {
    const { stakingPool, adrs } = await loadFixture(deployFixture)

    await stakingPool.reorderStrategies([1, 2, 0])
    let strategies = await stakingPool.getStrategies()
    assert.equal(
      JSON.stringify(strategies),
      JSON.stringify([adrs.strategy2, adrs.strategy3, adrs.strategy1]),
      'Strategies incorrectly ordered'
    )
  })

  it('should not be able to reorder strategies with invalid order', async () => {
    const { stakingPool } = await loadFixture(deployFixture)

    await expect(stakingPool.reorderStrategies([2, 2, 1])).to.be.revertedWith(
      'all indices must be valid'
    )

    await expect(stakingPool.reorderStrategies([1, 0])).to.be.revertedWith(
      'newOrder.length must = strategies.length'
    )

    await expect(stakingPool.reorderStrategies([3, 2, 1, 0])).to.be.revertedWith(
      'newOrder.length must = strategies.length'
    )
  })

  it('should be able to deposit into strategy', async () => {
    const { adrs, stakingPool, token } = await loadFixture(deployFixture)

    await token.transfer(adrs.stakingPool, toEther(1000))
    await stakingPool.strategyDeposit(0, toEther(300), '0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy1)), 300, 'Tokens not deposited')
  })

  it('should not be able to deposit into nonexistent strategy', async () => {
    const { adrs, stakingPool, token } = await loadFixture(deployFixture)

    await token.transfer(adrs.stakingPool, toEther(1000))
    await expect(stakingPool.strategyDeposit(3, toEther(1), '0x')).to.be.revertedWith(
      'Strategy does not exist'
    )
  })

  it('should be able to withdraw from strategy', async () => {
    const { adrs, stakingPool, token } = await loadFixture(deployFixture)

    await token.transfer(adrs.stakingPool, toEther(1000))
    await stakingPool.strategyDeposit(0, toEther(300), '0x')
    await stakingPool.strategyWithdraw(0, toEther(100), '0x')
    assert.equal(fromEther(await token.balanceOf(adrs.strategy1)), 200, 'Tokens not withdrawn')
  })

  it('should not be able to withdraw from nonexistent strategy', async () => {
    const { stakingPool } = await loadFixture(deployFixture)

    await expect(stakingPool.strategyWithdraw(3, toEther(1), '0x')).to.be.revertedWith(
      'Strategy does not exist'
    )
  })

  it('should be able to stake tokens', async () => {
    const { accounts, stakingPool, token, stake } = await loadFixture(deployFixture)

    await stake(2, 2000)
    await stake(1, 1000)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9000, 'Tokens not transferred')
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[2])),
      2000,
      'Account-2 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      2000,
      'Account-2 balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[1])),
      1000,
      'Account-1 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1000,
      'Account-1 balance not updated'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 3000, 'totalSupply not updated')
  })

  it('should not be able to stake more tokens than balance', async () => {
    const { stake } = await loadFixture(deployFixture)
    await expect(stake(1, 10001)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
  })

  it('should be able to withdraw tokens', async () => {
    const { accounts, stakingPool, token, stake, withdraw } = await loadFixture(deployFixture)

    await stake(2, 2000)
    await stake(1, 1000)
    await withdraw(1, 500)
    await withdraw(2, 500)
    assert.equal(fromEther(await token.balanceOf(accounts[1])), 9500, 'Tokens not transferred')
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[2])),
      1500,
      'Account-2 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1500,
      'Account-2 balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.sharesOf(accounts[1])),
      500,
      'Account-1 shares balance not updated'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      500,
      'Account-1 balance not updated'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 2000, 'totalSupply not updated')
  })

  it('should not be able to withdraw more tokens than balance', async () => {
    const { strategy1, stake, withdraw } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await strategy1.setMinDeposits(0)
    await expect(withdraw(1, 1001)).to.be.revertedWith('Not enough liquidity available to withdraw')
  })

  it('staking should correctly deposit into strategies', async () => {
    const { adrs, token, stake } = await loadFixture(deployFixture)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy1)),
      1000,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy2)),
      2000,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy3)),
      2000,
      'Strategy-3 balance incorrect'
    )
  })

  it('withdrawing should correctly withdraw from strategies', async () => {
    const { adrs, stakingPool, token, stake, withdraw } = await loadFixture(deployFixture)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await stakingPool.strategyWithdraw(0, toEther(100), '0x')
    await withdraw(3, 2000)
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy1)),
      900,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy2)),
      2000,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy3)),
      100,
      'Strategy-3 balance incorrect'
    )
    await withdraw(1, 2000)
    await withdraw(2, 900)
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy1)),
      70,
      'Strategy-1 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy2)),
      20,
      'Strategy-2 balance incorrect'
    )
    assert.equal(
      fromEther(await token.balanceOf(adrs.strategy3)),
      10,
      'Strategy-3 balance incorrect'
    )
  })

  it('should be able to update strategy rewards', async () => {
    const { accounts, adrs, stakingPool, token, strategy2, erc677Receiver, stake } =
      await loadFixture(deployFixture)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await token.transfer(adrs.strategy1, toEther(1100))
    await token.transfer(adrs.strategy3, toEther(500))
    await strategy2.simulateSlash(toEther(400))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      2336,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1168,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      2336,
      'Account-3 balance incorrect'
    )
    assert.equal(
      Number(fromEther(await stakingPool.balanceOf(accounts[4]))),
      120,
      'Owners rewards balance incorrect'
    )
    assert.equal(
      Number(fromEther(await stakingPool.balanceOf(adrs.erc677Receiver))),
      240,
      'Delegator pool balance incorrect'
    )
    assert.equal(
      Number(fromEther(await erc677Receiver.totalRewards()).toFixed(2)),
      240,
      'Delegator pool rewards incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 6200, 'totalSupply incorrect')
  })

  it('fee splitting should work correctly', async () => {
    const { accounts, adrs, stakingPool, strategy1, strategy3, token, strategy2, stake } =
      await loadFixture(deployFixture)

    await stakingPool.addFee(accounts[0], 1000)
    await strategy1.setFeeBasisPoints(1000)
    await strategy3.setFeeBasisPoints(1000)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await token.transfer(adrs.strategy1, toEther(1000))
    await token.transfer(adrs.strategy3, toEther(600))
    await strategy2.simulateSlash(toEther(300))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      2248,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1124,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      2248,
      'Account-3 balance incorrect'
    )

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[4])),
      130,
      'Owners rewards balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      160 + 130,
      'Strategy fee balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(adrs.erc677Receiver)),
      260,
      'Delegation fee balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 6300, 'totalSupply incorrect')
  })

  it('should be able to update strategy rewards when negative', async () => {
    const { accounts, stakingPool, strategy3, stake } = await loadFixture(deployFixture)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await strategy3.simulateSlash(toEther(200))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1920,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      960,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1920,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[4])),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 4800, 'totalSupply incorrect')
  })

  it('fees should be distributed regardless of deposit change', async () => {
    const { accounts, adrs, stakingPool, strategy1, strategy2, strategy3, token, stake } =
      await loadFixture(deployFixture)

    await stake(1, 2000)
    await stake(2, 1000)
    await stake(3, 2000)
    await strategy3.simulateSlash(toEther(200))
    await strategy2.setFeeBasisPoints(1000)
    await token.transfer(adrs.strategy2, toEther(200))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      20,
      'Account-0 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1992,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      996,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1992,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[4])),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 5000, 'totalSupply incorrect')

    await strategy1.simulateSlash(toEther(290))
    await token.transfer(adrs.strategy2, toEther(100))
    await stakingPool.updateStrategyRewards([0, 1, 2], '0x')

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      29.2,
      'Account-0 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1912.32,
      'Account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      956.16,
      'Account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      1912.32,
      'Account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[4])),
      0,
      'Owners rewards balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.totalSupply()), 4810, 'totalSupply incorrect')
  })

  it('getStakeByShares and getSharesByStake should work correctly', async () => {
    const { adrs, stakingPool, token, strategy1, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stake(2, 1000)

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      10,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(10))),
      10,
      'getSharesByStake incorrect'
    )

    await token.transfer(adrs.strategy1, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')
    await stake(3, 1000)

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      13.5,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(13.5))),
      10,
      'getSharesByStake incorrect'
    )

    await strategy1.simulateSlash(toEther(2000))
    await stakingPool.updateStrategyRewards([0], '0x')

    assert.equal(
      fromEther(await stakingPool.getStakeByShares(toEther(10))),
      6.75,
      'getStakeByShares incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.getSharesByStake(toEther(6.75))),
      10,
      'getSharesByStake incorrect'
    )
  })

  it('should be able to transfer derivative tokens', async () => {
    const { signers, accounts, adrs, stakingPool, token, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stake(2, 1000)

    await token.transfer(adrs.strategy1, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    await stakingPool.connect(signers[1]).transfer(accounts[3], toEther(100))
    await stakingPool.connect(signers[3]).transfer(accounts[0], toEther(25))

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1250,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1350,
      'account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      75,
      'account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      25,
      'account-0 balance incorrect'
    )
  })

  it('should be able to transfer shares', async () => {
    const { signers, accounts, adrs, stakingPool, token, stake } = await loadFixture(deployFixture)

    await stakingPool.updateFee(0, accounts[0], 0)
    await stakingPool.updateFee(0, accounts[0], 0)
    await stake(1, 1000)
    await stake(2, 1000)

    await token.transfer(adrs.strategy1, toEther(1000))
    await stakingPool.updateStrategyRewards([0], '0x')

    await stakingPool.connect(signers[1]).transferShares(accounts[3], toEther(100))
    await stakingPool.connect(signers[3]).transferShares(accounts[0], toEther(50))

    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1350,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[2])),
      1500,
      'account-2 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[3])),
      75,
      'account-3 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      75,
      'account-0 balance incorrect'
    )

    await expect(stakingPool.transferShares(ethers.ZeroAddress, toEther(10))).to.be.revertedWith(
      'Transfer to the zero address'
    )
    await expect(stakingPool.transferShares(accounts[1], toEther(51))).to.be.revertedWith(
      'Transfer amount exceeds balance'
    )

    await stakingPool.connect(signers[1]).approve(accounts[0], toEther(50))
    await stakingPool.transferSharesFrom(accounts[1], accounts[0], toEther(10))
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[1])),
      1335,
      'account-1 balance incorrect'
    )
    assert.equal(
      fromEther(await stakingPool.balanceOf(accounts[0])),
      90,
      'account-0 balance incorrect'
    )
    assert.equal(fromEther(await stakingPool.allowance(accounts[1], accounts[0])), 35)

    await expect(
      stakingPool.transferSharesFrom(accounts[1], accounts[0], toEther(25))
    ).to.be.revertedWith('ERC20: insufficient allowance')
  })

  it('should be able to correctly calculate staking limits', async () => {
    const { stakingPool, strategy1, stake } = await loadFixture(deployFixture)

    let stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 13000, 'staking limit is not correct')

    await stake(1, 2000)
    stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 13000, 'staking limit is not correct')

    await strategy1.setMaxDeposits(toEther(2000))
    stakingLimit = await stakingPool.getMaxDeposits()
    assert.equal(fromEther(stakingLimit), 14000, 'staking limit is not correct')
  })

  it('getStrategyDepositRoom should work correctly', async () => {
    const { adrs, stakingPool, token, strategy1, strategy2, stake } = await loadFixture(
      deployFixture
    )

    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 13000)

    await stake(1, 2000)
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)

    await strategy1.setMaxDeposits(toEther(2000))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 12000)

    await strategy2.setMaxDeposits(toEther(0))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)

    await token.transfer(adrs.stakingPool, toEther(1000))
    assert.equal(fromEther(await stakingPool.getStrategyDepositRoom()), 11000)
  })

  it('burn should work correctly', async () => {
    const { signers, accounts, stakingPool, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stake(2, 3000)

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 3000)
    assert.equal(fromEther(await stakingPool.totalStaked()), 4000)

    await stakingPool.connect(signers[2]).burn(toEther(500))

    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[1])).toFixed(3)), 1142.857)
    assert.equal(Number(fromEther(await stakingPool.balanceOf(accounts[2])).toFixed(3)), 2857.143)
    assert.equal(fromEther(await stakingPool.totalStaked()), 4000)
  })

  it('donateTokens should work correctly', async () => {
    const { accounts, stakingPool, stake } = await loadFixture(deployFixture)

    await stake(1, 1000)
    await stake(2, 3000)

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1000)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 3000)
    assert.equal(fromEther(await stakingPool.totalStaked()), 4000)

    await stakingPool.donateTokens(toEther(500))

    assert.equal(fromEther(await stakingPool.balanceOf(accounts[1])), 1125)
    assert.equal(fromEther(await stakingPool.balanceOf(accounts[2])), 3375)
    assert.equal(fromEther(await stakingPool.totalStaked()), 4500)
  })
})
