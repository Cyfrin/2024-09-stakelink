import { assert, expect } from 'chai'
import {
  deploy,
  deployUpgradeable,
  fromEther,
  getAccounts,
  setupToken,
  toEther,
} from '../utils/helpers'
import { ERC677, LiquidSDIndexPool, LSDIndexAdapterMock } from '../../typechain-types'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

describe('LiquidSDIndexPool', () => {
  async function deployFixture() {
    const { accounts, signers } = await getAccounts()
    const adrs: any = {}

    const lsd1 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token 1',
      'LSD1',
      100000000,
    ])) as ERC677
    adrs.lsd1 = await lsd1.getAddress()

    const lsd2 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token 2',
      'LSD2',
      100000000,
    ])) as ERC677
    adrs.lsd2 = await lsd2.getAddress()

    await setupToken(lsd1, accounts)
    await setupToken(lsd2, accounts)

    const pool = (await deployUpgradeable('LiquidSDIndexPool', [
      'Staked ETH Index',
      'iETH',
      5000,
      toEther(10000),
      [
        [accounts[3], 1000],
        [accounts[4], 500],
      ],
      0,
    ])) as LiquidSDIndexPool
    adrs.pool = await pool.getAddress()

    const adapter1 = (await deployUpgradeable('LSDIndexAdapterMock', [
      adrs.lsd1,
      adrs.pool,
      toEther(1),
    ])) as LSDIndexAdapterMock
    adrs.adapter1 = await adapter1.getAddress()

    const adapter2 = (await deployUpgradeable('LSDIndexAdapterMock', [
      adrs.lsd2,
      adrs.pool,
      toEther(2),
    ])) as LSDIndexAdapterMock
    adrs.adapter2 = await adapter2.getAddress()

    await pool.addLSDToken(adrs.lsd1, adrs.adapter1, [10000])
    await pool.addLSDToken(adrs.lsd2, adrs.adapter2, [7000, 3000])
    await lsd1.approve(adrs.pool, ethers.MaxUint256)
    await lsd2.approve(adrs.pool, ethers.MaxUint256)
    await lsd1.connect(signers[1]).approve(adrs.pool, ethers.MaxUint256)
    await lsd2.connect(signers[1]).approve(adrs.pool, ethers.MaxUint256)
    await pool.connect(signers[1]).deposit(adrs.lsd1, toEther(2000))
    await pool.connect(signers[1]).deposit(adrs.lsd2, toEther(500))

    return { signers, accounts, adrs, lsd1, lsd2, pool, adapter1, adapter2 }
  }

  it('addLSDToken should work correctly', async () => {
    const { adrs, pool } = await loadFixture(deployFixture)

    let lsd3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token 2',
      'LSD2',
      100000000,
    ])) as ERC677
    adrs.lsd3 = await lsd3.getAddress()

    let adapter3 = (await deployUpgradeable('LSDIndexAdapterMock', [
      adrs.lsd3,
      adrs.pool,
      toEther(5),
    ])) as LSDIndexAdapterMock
    adrs.adapter3 = await adapter3.getAddress()

    await expect(pool.addLSDToken(adrs.lsd1, adrs.adapter1, [2000, 8000])).to.be.revertedWith(
      'Token is already supported'
    )
    await expect(pool.addLSDToken(adrs.lsd3, adrs.adapter3, [2000, 8000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
    await expect(pool.addLSDToken(adrs.lsd3, adrs.adapter3, [1000, 8000, 2000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )

    await pool.addLSDToken(adrs.lsd3, adrs.adapter3, [5000, 3000, 2000])
    assert.deepEqual(await pool.getLSDTokens(), [adrs.lsd1, adrs.lsd2, adrs.lsd3])
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => Number(t)),
      [5000, 3000, 2000]
    )
    assert.equal(await pool.lsdAdapters(adrs.lsd1), adrs.adapter1)
    assert.equal(await pool.lsdAdapters(adrs.lsd2), adrs.adapter2)
    assert.equal(await pool.lsdAdapters(adrs.lsd3), adrs.adapter3)
  })

  it('removeLSDToken should work correctly', async () => {
    const { signers, adrs, pool } = await loadFixture(deployFixture)

    let lsd3 = (await deploy('contracts/core/tokens/base/ERC677.sol:ERC677', [
      'Liquid SD Token 2',
      'LSD2',
      100000000,
    ])) as ERC677
    adrs.lsd3 = await lsd3.getAddress()

    let adapter3 = (await deployUpgradeable('LSDIndexAdapterMock', [
      adrs.lsd3,
      adrs.pool,
      toEther(5),
    ])) as LSDIndexAdapterMock
    adrs.adapter3 = await adapter3.getAddress()
    await pool.addLSDToken(adrs.lsd3, adrs.adapter3, [5000, 3000, 2000])

    await expect(pool.removeLSDToken(adrs.lsd2, [2000, 8000])).to.be.revertedWith(
      'Cannot remove adapter that contains deposits'
    )
    await expect(pool.removeLSDToken(adrs.lsd3, [2000, 7000, 1000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
    await expect(pool.removeLSDToken(adrs.lsd3, [2000, 7000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )

    await pool.connect(signers[1]).withdraw(toEther(2999))
    await pool.removeLSDToken(adrs.lsd2, [2000, 8000])

    assert.deepEqual(await pool.getLSDTokens(), [adrs.lsd1, adrs.lsd3])
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => Number(t)),
      [2000, 8000]
    )
    assert.equal(await pool.lsdAdapters(adrs.lsd1), adrs.adapter1)
    assert.equal(await pool.lsdAdapters(adrs.lsd2), ethers.ZeroAddress)
    assert.equal(await pool.lsdAdapters(adrs.lsd3), adrs.adapter3)
  })

  it('deposit should work correctly', async () => {
    const { signers, accounts, adrs, pool, lsd1, lsd2 } = await loadFixture(deployFixture)

    await lsd1.connect(signers[2]).approve(adrs.pool, ethers.MaxUint256)
    await lsd2.connect(signers[2]).approve(adrs.pool, ethers.MaxUint256)
    await pool.connect(signers[2]).deposit(adrs.lsd1, toEther(1000))
    await pool.connect(signers[2]).deposit(adrs.lsd2, toEther(250))

    assert.equal(fromEther(await pool.balanceOf(accounts[1])), 3000)
    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1500)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 3000)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 750)
    assert.equal(fromEther(await pool.totalSupply()), 4500)

    await expect(pool.deposit(accounts[1], toEther(100))).to.be.revertedWith(
      'Token is not supported'
    )
    await expect(pool.deposit(adrs.lsd2, toEther(2000))).to.be.revertedWith(
      'Insufficient deposit room for the selected lsd'
    )
  })

  it('withdraw should work correctly', async () => {
    const { signers, accounts, adrs, pool, lsd1, lsd2 } = await loadFixture(deployFixture)

    await lsd1.connect(signers[2]).approve(adrs.pool, ethers.MaxUint256)
    await lsd2.connect(signers[2]).approve(adrs.pool, ethers.MaxUint256)
    await pool.connect(signers[2]).deposit(adrs.lsd1, toEther(1000))
    await pool.connect(signers[2]).deposit(adrs.lsd2, toEther(250))

    await pool.connect(signers[1]).withdraw(toEther(200))

    assert.equal(fromEther(await pool.balanceOf(accounts[1])), 2800)
    assert.equal(fromEther(await pool.totalSupply()), 4300)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 3000)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 650)

    await pool.connect(signers[2]).withdraw(toEther(100))

    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1400)
    assert.equal(fromEther(await pool.totalSupply()), 4200)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 2940)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 630)

    await pool.connect(signers[2]).deposit(adrs.lsd1, toEther(500))
    await pool.connect(signers[2]).withdraw(toEther(200))

    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 1700)
    assert.equal(fromEther(await pool.totalSupply()), 4500)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 3240)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 630)

    await pool.setCompositionTargets([10000, 0])
    await pool.connect(signers[2]).withdraw(toEther(1400))

    assert.equal(fromEther(await pool.balanceOf(accounts[2])), 300)
    assert.equal(fromEther(await pool.totalSupply()), 3100)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 3100)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 0)

    assert.equal(fromEther(await lsd1.balanceOf(accounts[1])), 8000)
    assert.equal(fromEther(await lsd2.balanceOf(accounts[1])), 9600)
    assert.equal(fromEther(await lsd1.balanceOf(accounts[2])), 8900)
    assert.equal(fromEther(await lsd2.balanceOf(accounts[2])), 10400)

    await expect(pool.connect(signers[2]).withdraw(toEther(301))).to.be.revertedWith(
      'Burn amount exceeds balance'
    )
  })

  it('getting/setting compositionTargets should work correctly', async () => {
    const { pool } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => Number(t)),
      [7000, 3000]
    )
    await pool.setCompositionTargets([1000, 9000])
    assert.deepEqual(
      (await pool.getCompositionTargets()).map((t) => Number(t)),
      [1000, 9000]
    )

    await expect(pool.setCompositionTargets([2000, 3000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )
    await expect(pool.setCompositionTargets([2000, 9000])).to.be.revertedWith(
      'Composition targets must sum to 100%'
    )
    await expect(pool.setCompositionTargets([10000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
    await expect(pool.setCompositionTargets([1000, 2000, 7000])).to.be.revertedWith(
      'Invalid composition targets length'
    )
  })

  it('getComposition should work correctly', async () => {
    const { signers, adrs, pool } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await pool.getComposition()).map((c) => Number(c)),
      [6666, 3333]
    )
    await pool.deposit(adrs.lsd1, toEther(1000))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => Number(c)),
      [7500, 2500]
    )
    await pool.deposit(adrs.lsd2, toEther(500))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => Number(c)),
      [6000, 4000]
    )
    await pool.withdraw(toEther(100))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => Number(c)),
      [6122, 3877]
    )
    await pool.connect(signers[1]).withdraw(toEther(700))
    assert.deepEqual(
      (await pool.getComposition()).map((c) => Number(c)),
      [6999, 3000]
    )
  })

  it('getDepositRoom should work correctly', async () => {
    const { adrs, pool, adapter2 } = await loadFixture(deployFixture)

    await adapter2.setExchangeRate(toEther(1))
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd1)), 5000)
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd2)), 2500)

    await pool.deposit(adrs.lsd1, toEther(5000))
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd1)), 0)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd2)).toFixed(3)), 5227.273)

    await pool.deposit(adrs.lsd2, toEther(2000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 7166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd2)).toFixed(3)), 3227.273)

    await pool.deposit(adrs.lsd2, toEther(3000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 24166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd2)).toFixed(3)), 227.273)

    await pool.setCompositionTolerance(2500)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 11944.444)
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd2)), 0)

    await pool.deposit(adrs.lsd1, toEther(6000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 5944.444)
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd2)), 2300)

    await pool.setCompositionTolerance(8000)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 73166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd2)).toFixed(3)), 9760.87)

    await pool.setCompositionEnforcementThreshold(toEther(30000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 73166.667)
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd2)).toFixed(3)), 9760.87)

    await pool.setCompositionEnforcementThreshold(toEther(100000))
    assert.equal(Number(fromEther(await pool.getDepositRoom(adrs.lsd1)).toFixed(3)), 73166.667)
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd2)), 24500)

    await pool.setCompositionTargets([10000, 0])
    assert.equal(await pool.getDepositRoom(adrs.lsd1), ethers.MaxUint256 - toEther(18500))
    assert.equal(fromEther(await pool.getDepositRoom(adrs.lsd2)), 0)
  })

  it('getRewards should work correctly', async () => {
    const { pool, adapter1, adapter2 } = await loadFixture(deployFixture)

    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [0, 0]
    )

    await adapter1.setExchangeRate(toEther(1.5))
    await adapter2.setExchangeRate(toEther(1))

    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [500, 75]
    )

    await pool.updateRewards()
    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [0, 0]
    )

    await adapter1.setExchangeRate(toEther(1))

    assert.deepEqual(
      (await pool.getRewards()).map((e) => fromEther(e)),
      [-1000, 0]
    )
  })

  it('updateRewards should work correctly', async () => {
    const { accounts, pool, adapter1, adapter2 } = await loadFixture(deployFixture)

    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 3000)
    assert.equal(fromEther(await pool.balanceOf(accounts[3])), 0)
    assert.equal(fromEther(await pool.balanceOf(accounts[4])), 0)

    await adapter1.setExchangeRate(toEther(1.5))
    await adapter2.setExchangeRate(toEther(1))

    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 3500)
    assert.equal(fromEther(await pool.balanceOf(accounts[3])), 50)
    assert.equal(fromEther(await pool.balanceOf(accounts[4])), 25)

    await adapter1.setExchangeRate(toEther(1))

    await pool.updateRewards()
    assert.equal(fromEther(await pool.totalSupply()), 2500)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[3])).toFixed(3)), 35.714)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[4])).toFixed(3)), 17.857)
  })

  it('withdrawal fee should work correctly', async () => {
    const { signers, accounts, adrs, pool, adapter2, lsd1, lsd2 } = await loadFixture(deployFixture)

    await pool.setCompositionTargets([8000, 2000])
    await adapter2.setExchangeRate(toEther(1))
    await pool.updateRewards()

    await pool.setWithdrawalFee(50)
    assert.equal(Number(await pool.withdrawalFee()), 50)

    assert.deepEqual(
      (await pool.getWithdrawalAmounts(toEther(500))).map((e) => fromEther(e)),
      [398, 99.5]
    )

    await pool.connect(signers[1]).withdraw(toEther(500))
    assert.equal(fromEther(await pool.balanceOf(accounts[1])), 2002.5)
    assert.equal(fromEther(await pool.totalSupply()), 2002.5)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 1602)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 400.5)

    await lsd2.connect(signers[2]).approve(adrs.pool, ethers.MaxUint256)
    await pool.connect(signers[2]).deposit(adrs.lsd2, toEther(200.5))
    await pool.setWithdrawalFee(200)

    assert.deepEqual(
      (await pool.getWithdrawalAmounts(toEther(100))).map((e) => fromEther(e)),
      [0, 98]
    )

    await pool.connect(signers[2]).withdraw(toEther(100))
    assert.equal(fromEther(await pool.totalSupply()), 2105)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[1])).toFixed(3)), 2004.404)
    assert.equal(Number(fromEther(await pool.balanceOf(accounts[2])).toFixed(3)), 100.596)
    assert.equal(fromEther(await lsd1.balanceOf(adrs.adapter1)), 1602)
    assert.equal(fromEther(await lsd2.balanceOf(adrs.adapter2)), 503)

    await expect(pool.setWithdrawalFee(501)).to.be.revertedWith('Withdrawal fee must be <= 5%')
  })

  it('pausing should work correctly', async () => {
    const { signers, adrs, pool } = await loadFixture(deployFixture)

    await expect(pool.setPaused(false)).to.be.revertedWith('This pause status is already set')

    await pool.setPaused(true)

    await expect(pool.setPaused(true)).to.be.revertedWith('This pause status is already set')
    await expect(pool.connect(signers[1]).deposit(adrs.lsd1, 10)).to.be.revertedWith(
      'Contract is paused'
    )
    await expect(pool.connect(signers[1]).withdraw(10)).to.be.revertedWith('Contract is paused')
    await expect(pool.updateRewards()).to.be.revertedWith('Contract is paused')

    await pool.setPaused(false)

    await pool.connect(signers[1]).deposit(adrs.lsd1, 10)
    await pool.connect(signers[1]).withdraw(10)
    await pool.updateRewards()
  })
})
